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
    failed_video_compute_units = 0.0
    for v in videos:
        compute_units = _gvc(v)
        if v.get("status") in {"failed", "poll_failed"}:
            failed_video_compute_units += compute_units
        total_video_compute_units += compute_units
        if v.get("storyboard_id"):
            storyboard_video_compute_units += compute_units
        # UI 指标：仅已完成视频
        if v.get("status") == "completed":
            duration = float(v.get("duration") or 0)
            total_video_seconds += duration
            if v.get("storyboard_id"):
                storyboard_video_seconds += duration
                completed_storyboard_ids.add(v["storyboard_id"])

    # 图片消耗改为按记录遍历（尊重 actual_cost / ZERO_COST_MODELS）
    images = ImageService.list_images(project_id)
    total_image_cost = sum(_gic(img) for img in images)
    total_images = len(images)
    generated_images = sum(1 for img in images if img.get("model") not in {"manual_upload", "split"})
    episodes = AssetService.list_assets(project_id, "episode")
    characters = AssetService.list_assets(project_id, "character")
    scenes = AssetService.list_assets(project_id, "scene")
    props = AssetService.list_assets(project_id, "prop")
    total_assets = len(characters) + len(scenes) + len(props)
    other_cost = total_storyboards * 40 + total_assets * 4
    total_compute_spent = round(total_image_cost + total_video_compute_units + other_cost, 2)

    return {
        "episode_count": len(episodes),
        "total_storyboards": total_storyboards,
        "storyboards_with_image": storyboards_with_image,
        "storyboards_with_video": len(completed_storyboard_ids),
        "total_images": total_images,
        "generated_images": generated_images,
        "total_image_cost": round(total_image_cost, 2),
        "total_video_seconds": total_video_seconds,
        "storyboard_video_seconds": storyboard_video_seconds,
        "total_video_compute_units": total_video_compute_units,
        "storyboard_video_compute_units": storyboard_video_compute_units,
        "failed_video_compute_units": round(failed_video_compute_units, 2),
        "other_cost": other_cost,
        "total_compute_spent": total_compute_spent,
    }


def _build_user_cost_summary(projects: list[dict]) -> dict:
    """基于已加载项目列表按用户汇总实际消耗（复用内存缓存，不扫磁盘）"""
    user_costs: dict[str, dict] = {}

    for project in projects:
        project_id = project.get("project_id")
        if not project_id:
            continue

        for img in ImageService.list_images(project_id):
            username = (img.get("created_by") or "").strip() or "__unknown__"
            cost = get_image_cost(img)
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += cost
            entry["total_cost"] += cost

        for video in VideoService.list_videos(project_id):
            username = (video.get("created_by") or "").strip() or "__unknown__"
            cost = get_video_cost(video)
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["video_cost"] += cost
            entry["total_cost"] += cost

    unknown = user_costs.pop("__unknown__", {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
    users = []
    for username, costs in sorted(user_costs.items(), key=lambda x: x[1]["total_cost"], reverse=True):
        user = get_user_by_username(username)
        users.append({
            "username": username,
            "display_name": user.get("display_name") if user else username,
            **costs,
        })

    return {
        "users": users,
        "unknown_cost": round(unknown["total_cost"], 2),
    }


def _build_project_cost_breakdown(project_id: str) -> dict:
    daily_costs: dict[str, dict] = {}
    episode_costs: dict[str, dict] = {}

    def add_daily_cost(date: str, cost_type: str, cost: float) -> None:
        if not date or len(date) != 10 or cost <= 0:
            return
        entry = daily_costs.setdefault(date, {"date": date, "image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
        entry[cost_type] += cost
        entry["total_cost"] += cost

    def add_episode_cost(episode_id: str, cost_type: str, cost: float) -> None:
        if not episode_id or cost <= 0:
            return
        entry = episode_costs.setdefault(episode_id, {
            "episode_id": episode_id,
            "name": "未知剧集",
            "episode_number": 999999,
            "image_cost": 0.0,
            "video_cost": 0.0,
            "total_cost": 0.0,
        })
        entry[cost_type] += cost
        entry["total_cost"] += cost

    episodes = AssetService.list_assets(project_id, "episode")
    storyboards = AssetService.list_assets(project_id, "storyboard")
    storyboard_episode_map = {
        storyboard.get("asset_id"): storyboard.get("episode_id")
        for storyboard in storyboards
        if storyboard.get("asset_id") and storyboard.get("episode_id")
    }

    for index, episode in enumerate(episodes, start=1):
        episode_id = episode.get("asset_id")
        if not episode_id:
            continue
        episode_number = episode.get("episode_number") or index
        episode_costs[episode_id] = {
            "episode_id": episode_id,
            "name": episode.get("name") or f"第 {episode_number} 集",
            "episode_number": episode_number,
            "image_cost": 0.0,
            "video_cost": 0.0,
            "total_cost": 0.0,
        }

    for img in ImageService.list_images(project_id):
        cost = get_image_cost(img)
        created_at = img.get("created_at")
        if created_at:
            add_daily_cost(str(created_at)[:10], "image_cost", cost)
        if img.get("asset_type") == "storyboard":
            episode_id = storyboard_episode_map.get(img.get("asset_id"))
            if episode_id:
                add_episode_cost(episode_id, "image_cost", cost)

    for video in VideoService.list_videos(project_id):
        cost = get_video_cost(video)
        created_at = video.get("created_at")
        if created_at:
            add_daily_cost(str(created_at)[:10], "video_cost", cost)
        episode_id = storyboard_episode_map.get(video.get("storyboard_id"))
        if episode_id:
            add_episode_cost(episode_id, "video_cost", cost)

    return {
        "daily_costs": [
            {
                "date": item["date"],
                "image_cost": round(item["image_cost"], 2),
                "video_cost": round(item["video_cost"], 2),
                "total_cost": round(item["total_cost"], 2),
            }
            for item in sorted(daily_costs.values(), key=lambda x: x["date"])
            if item["total_cost"] > 0
        ],
        "episode_costs": [
            {
                "episode_id": item["episode_id"],
                "name": item["name"],
                "episode_number": item["episode_number"],
                "image_cost": round(item["image_cost"], 2),
                "video_cost": round(item["video_cost"], 2),
                "total_cost": round(item["total_cost"], 2),
            }
            for item in sorted(episode_costs.values(), key=lambda x: x.get("episode_number") or 0)
            if item["total_cost"] > 0
        ],
    }


def _build_project_daily_costs(project_id: str) -> list[dict]:
    return _build_project_cost_breakdown(project_id)["daily_costs"]


def _build_project_user_costs(project_id: str) -> tuple[dict[str, dict], dict[str, float]]:
    user_costs: dict[str, dict] = {}
    unknown_costs = {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0}

    for img in ImageService.list_images(project_id):
        username = (img.get("created_by") or "").strip()
        cost = get_image_cost(img)
        if username:
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += cost
            entry["total_cost"] += cost
        else:
            unknown_costs["image_cost"] += cost
            unknown_costs["total_cost"] += cost

    for video in VideoService.list_videos(project_id):
        username = (video.get("created_by") or "").strip()
        cost = get_video_cost(video)
        if username:
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["video_cost"] += cost
            entry["total_cost"] += cost
        else:
            unknown_costs["video_cost"] += cost
            unknown_costs["total_cost"] += cost

    return user_costs, unknown_costs


def _build_user_cost_summary_from_project_costs(project_costs: list[dict]) -> dict:
    user_costs: dict[str, dict] = {}
    unknown_cost = 0.0

    for item in project_costs:
        unknown_cost += float(item.get("unknown_cost") or 0)
        for username, costs in (item.get("user_costs") or {}).items():
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += float(costs.get("image_cost") or 0)
            entry["video_cost"] += float(costs.get("video_cost") or 0)
            entry["total_cost"] += float(costs.get("total_cost") or 0)

    users = []
    for username, costs in sorted(user_costs.items(), key=lambda x: x[1]["total_cost"], reverse=True):
        user = get_user_by_username(username)
        users.append({
            "username": username,
            "display_name": user.get("display_name") if user else username,
            "image_cost": round(costs["image_cost"], 2),
            "video_cost": round(costs["video_cost"], 2),
            "total_cost": round(costs["total_cost"], 2),
        })

    return {"users": users, "unknown_cost": round(unknown_cost, 2)}


def _get_project_home_stats(project_id: str) -> dict:
    from app.services.asset_service import _assets_cache, _images_cache, _videos_cache
    from app.services.project_stats_snapshot_service import read_snapshot, write_snapshot

    has_runtime_cache = project_id in _images_cache or project_id in _videos_cache or project_id in _assets_cache
    if has_runtime_cache:
        stats = _build_project_stats(project_id)
        user_costs, unknown_costs = _build_project_user_costs(project_id)
        return {
            "stats": stats,
            "user_costs": user_costs,
            "unknown_cost": unknown_costs["total_cost"],
            "unknown_costs": unknown_costs,
        }

    snapshot = read_snapshot(project_id)
    if snapshot and snapshot.get("unknown_costs"):
        print(f"[STATS SNAPSHOT HIT] project={project_id[:8]}")
        return snapshot

    stats = _build_project_stats(project_id)
    user_costs, unknown_costs = _build_project_user_costs(project_id)
    write_snapshot(project_id, stats, user_costs, unknown_costs)
    print(f"[STATS SNAPSHOT WRITE] project={project_id[:8]}")
    return {
        "stats": stats,
        "user_costs": user_costs,
        "unknown_cost": unknown_costs["total_cost"],
        "unknown_costs": unknown_costs,
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


@router.get("")
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
                return {
                    "projects": projects,
                    "user_summary": _build_user_cost_summary(projects),
                }
            return projects
        return []

    projects = ProjectService.list_projects()
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        user = get_user_by_username(admin_user["sub"])
        allowed = set(user.get("assigned_project_ids") or []) if user else set()
        projects = [p for p in projects if p.get("project_id") in allowed]

    if include_stats:
        project_costs = []
        for p in projects:
            item = _get_project_home_stats(p["project_id"])
            p["stats"] = item.get("stats")
            p["user_costs"] = item.get("user_costs") or {}
            p["unknown_costs"] = item.get("unknown_costs") or {}
            project_costs.append(item)
        return {
            "projects": projects,
            "user_summary": _build_user_cost_summary_from_project_costs(project_costs),
        }

    return projects


@router.get("/{project_id}", response_model=dict)
async def get_project(project_id: str):
    """获取项目详情"""
    result = ProjectService.get_project(project_id)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    from app.services.project_stats_snapshot_service import delete_snapshot
    delete_snapshot(project_id)
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
    from app.services.project_stats_snapshot_service import delete_snapshot
    delete_snapshot(project_id)
    return result


@router.get("/{project_id}/stats")
async def get_project_stats(project_id: str):
    """获取项目统计数据"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return _build_project_stats(project_id)


@router.get("/{project_id}/cost-daily")
async def get_project_daily_costs(project_id: str):
    """获取项目按日期聚合的图片/视频消耗"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return _build_project_daily_costs(project_id)


@router.get("/{project_id}/cost-breakdown")
async def get_project_cost_breakdown(project_id: str):
    """获取项目消耗看板的日期/集聚合数据"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return _build_project_cost_breakdown(project_id)


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

        # 扫描视频记录（所有状态都计入，平台在提交任务时已扣积分）
        videos_dir = project_dir / "videos"
        if videos_dir.exists():
            for vf in videos_dir.glob("*.json"):
                try:
                    v = _json.loads(vf.read_text(encoding="utf-8"))
                except Exception:
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
