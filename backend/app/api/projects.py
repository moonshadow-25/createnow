from fastapi import APIRouter, HTTPException, Request, Query
from typing import List, Optional
from pydantic import BaseModel
import uuid
from datetime import datetime

from app.services import ProjectService
from app.services.asset_service import AssetService, ImageService, VideoService
from app.services.auth_service import get_auth_state
from app.services.user_service import get_user_by_username
from app.core.config import settings
from app.core.context import get_current_data_root
from app.api.generation.utils import calc_video_compute_units, get_image_cost, get_video_cost

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


def _build_project_stats(project_id: str) -> dict:
    """构建项目统计数据（复用缓存，避免磁盘遍历）"""
    storyboards = AssetService.list_assets(project_id, "storyboard")
    total_storyboards = len(storyboards)
    storyboards_with_image = sum(1 for s in storyboards if s.get("image_id"))

    from app.api.generation.utils import get_image_cost as _gic, get_video_cost as _gvc

    videos = VideoService.list_videos(project_id)
    completed_storyboard_ids: set = set()
    total_video_seconds = 0.0
    storyboard_video_seconds = 0.0
    total_video_compute_units = 0.0
    storyboard_video_compute_units = 0.0
    for v in videos:
        if v.get("status") == "completed":
            duration = float(v.get("duration") or 0)
            compute_units = _gvc(v)
            total_video_seconds += duration
            total_video_compute_units += compute_units
            if v.get("storyboard_id"):
                storyboard_video_seconds += duration
                storyboard_video_compute_units += compute_units
                completed_storyboard_ids.add(v["storyboard_id"])

    # 图片消耗改为按记录遍历（尊重 actual_cost / ZERO_COST_MODELS）
    images = ImageService.list_images(project_id)
    total_image_cost = sum(_gic(img) for img in images)
    total_images = len(images)
    episodes = AssetService.list_assets(project_id, "episode")
    total_compute_spent = round(total_image_cost + total_video_compute_units, 2)

    return {
        "episode_count": len(episodes),
        "total_storyboards": total_storyboards,
        "storyboards_with_image": storyboards_with_image,
        "storyboards_with_video": len(completed_storyboard_ids),
        "total_images": total_images,
        "total_video_seconds": total_video_seconds,
        "storyboard_video_seconds": storyboard_video_seconds,
        "total_video_compute_units": total_video_compute_units,
        "storyboard_video_compute_units": storyboard_video_compute_units,
        "total_compute_spent": total_compute_spent,
    }


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str = None
    description: str = None
    ai_config: dict = None
    total_episodes: int = None
    minutes_per_episode: float = None
    compute_budget_per_minute: float = None
    project_duration_days: int = None
    rating: Optional[float] = None
    review: Optional[str] = None


async def _get_active_api_key(request: Request) -> Optional[str]:
    """获取当前有效的 API Key。
    SaaS 模式：从 request.state.saas_user 读取（Redis 中的用户信息）。
    selfhosted 模式：从 global.json 读取（原有逻辑）。
    """
    if settings.DEPLOY_MODE == "saas":
        saas_user = getattr(request.state, "saas_user", None)
        return (saas_user or {}).get("api_key")
    auth = get_auth_state()
    return auth.get("api_key") if auth.get("logged_in") else None


@router.post("", response_model=dict)
async def create_project(request: Request, project: ProjectCreate):
    """创建新项目"""
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        raise HTTPException(status_code=403, detail="子账号不能创建项目")
    result = ProjectService.create_project(project.name, project.description)

    # SaaS 模式：将新项目加入用户的项目索引，并写入反向索引
    if settings.DEPLOY_MODE == "saas":
        saas_user = getattr(request.state, "saas_user", None)
        if saas_user:
            from app.services.user_saas_service import add_user_project
            from app.core.redis_client import get_redis
            await add_user_project(saas_user["user_id"], result["project_id"])
            r = await get_redis()
            await r.set(f"project_owner:{result['project_id']}", saas_user["user_id"])

    # 若用户已登录，为新项目创建完整的 createnow 预设结构
    auth_api_key = await _get_active_api_key(request)
    if auth_api_key:
        ai_config = result.get("ai_config", {})
        base_url = settings.CREATENOW_BASE_URL
        now = datetime.now().isoformat()

        config_presets: dict = {"llm": [], "vlm": [], "image": [], "video": [], "tts": []}
        active_preset_ids: dict = {}

        for svc in ["llm", "vlm", "image", "video", "tts"]:
            preset_id = str(uuid.uuid4())
            preset_config: dict = {
                "api_type": "createnow",
                "api_url": base_url,
                "api_key": auth_api_key,
                "model": "nova-pro"
            }
            if svc == "tts":
                preset_config["voice"] = ""
            elif svc == "image":
                preset_config["image_edit_model"] = ""
            elif svc == "video":
                preset_config["generate_audio"] = True
                preset_config["multimodal_reference"] = True

            config_presets[svc].append({
                "id": preset_id,
                "name": "CreateNow",
                "config": preset_config,
                "created_at": now
            })
            active_preset_ids[svc] = preset_id

            # 同步到直接服务配置（供 get_ai_service 使用）
            if svc not in ai_config:
                ai_config[svc] = {}
            ai_config[svc]["api_type"] = "createnow"
            ai_config[svc]["api_url"] = base_url
            ai_config[svc]["api_key"] = auth_api_key
            ai_config[svc]["model"] = "nova-pro"
            if svc == "video":
                ai_config[svc]["generate_audio"] = True
                ai_config[svc]["multimodal_reference"] = True

        ai_config["config_presets"] = config_presets
        ai_config["active_preset_ids"] = active_preset_ids

        ProjectService.update_project(result["project_id"], ai_config=ai_config)
        result["ai_config"] = ai_config

    return result


@router.get("", response_model=List[dict])
async def list_projects(request: Request, include_stats: bool = Query(False)):
    """列出所有项目"""
    # SaaS 模式：只列出当前用户的项目
    if settings.DEPLOY_MODE == "saas":
        saas_user = getattr(request.state, "saas_user", None)
        if saas_user:
            from app.services.user_saas_service import get_user_project_ids
            project_ids = await get_user_project_ids(saas_user["user_id"])
            all_projects = ProjectService.list_projects()
            projects = [p for p in all_projects if p.get("project_id") in set(project_ids)]
            if include_stats:
                for p in projects:
                    p["stats"] = _build_project_stats(p["project_id"])
            return projects
        return []

    projects = ProjectService.list_projects()
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        user = get_user_by_username(admin_user["sub"])
        allowed = set(user.get("assigned_project_ids") or []) if user else set()
        projects = [p for p in projects if p.get("project_id") in allowed]

    if include_stats:
        for p in projects:
            p["stats"] = _build_project_stats(p["project_id"])

    return projects


@router.get("/{project_id}", response_model=dict)
async def get_project(project_id: str):
    """获取项目详情"""
    result = ProjectService.get_project(project_id)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.put("/{project_id}", response_model=dict)
async def update_project(project_id: str, project: ProjectUpdate):
    """更新项目"""
    update_data = {}
    if project.name is not None:
        update_data["name"] = project.name
    if project.description is not None:
        update_data["description"] = project.description
    if project.ai_config is not None:
        update_data["ai_config"] = project.ai_config
    for field in ["total_episodes", "minutes_per_episode", "compute_budget_per_minute", "project_duration_days", "rating", "review"]:
        val = getattr(project, field)
        if val is not None:
            update_data[field] = val

    result = ProjectService.update_project(project_id, **update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.get("/{project_id}/stats")
async def get_project_stats(project_id: str):
    """获取项目统计数据"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return _build_project_stats(project_id)


@router.delete("/{project_id}")
async def delete_project(request: Request, project_id: str):
    """删除项目"""
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        raise HTTPException(status_code=403, detail="子账号不能删除项目")
    success = ProjectService.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


class SetBudgetRequest(BaseModel):
    budget_total: Optional[float] = None  # None = 移除预算限制


@router.put("/{project_id}/budget", response_model=dict)
async def set_project_budget(project_id: str, body: SetBudgetRequest, request: Request):
    """设置项目总预算（仅管理员）"""
    admin_user = getattr(request.state, "admin_user", None)
    if not admin_user or admin_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可设置项目预算")

    result = ProjectService.update_project(project_id, budget_total=body.budget_total)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.get("/stats/by-user")
async def get_stats_by_user():
    """按用户汇总所有项目的实际消耗（基于 created_by 字段，优先 actual_cost）"""
    import json as _json
    projects_dir = _get_projects_dir()
    user_costs: dict[str, dict] = {}  # username -> {image_cost, video_cost, total_cost}

    if not projects_dir.exists():
        return {"users": [], "unknown_cost": 0}

    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir():
            continue

        # 扫描图片记录
        images_dir = project_dir / "images"
        if images_dir.exists():
            for img_file in images_dir.glob("*.json"):
                try:
                    img = _json.loads(img_file.read_text(encoding="utf-8"))
                except Exception:
                    continue
                username = (img.get("created_by") or "").strip() or "__unknown__"
                cost = get_image_cost(img)
                entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
                entry["image_cost"] += cost
                entry["total_cost"] += cost

        # 扫描视频记录
        videos_dir = project_dir / "videos"
        if videos_dir.exists():
            for vf in videos_dir.glob("*.json"):
                try:
                    v = _json.loads(vf.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if v.get("status") != "completed":
                    continue
                username = (v.get("created_by") or "").strip() or "__unknown__"
                cost = get_video_cost(v)
                entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
                entry["video_cost"] += cost
                entry["total_cost"] += cost

    unknown = user_costs.pop("__unknown__", {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
    users = [
        {"username": uname, **costs}
        for uname, costs in sorted(user_costs.items(), key=lambda x: x[1]["total_cost"], reverse=True)
    ]

    return {
        "users": users,
        "unknown_cost": round(unknown["total_cost"], 2),
    }
