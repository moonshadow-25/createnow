from fastapi import APIRouter, HTTPException, Request
from typing import List, Optional
from pydantic import BaseModel
import uuid
import json as _json
from datetime import datetime

from app.services import ProjectService
from app.services.asset_service import AssetService
from app.services.auth_service import get_auth_state
from app.services.user_service import get_user_by_username
from app.core.config import settings

router = APIRouter(prefix="/projects", tags=["projects"])


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


@router.post("", response_model=dict)
async def create_project(request: Request, project: ProjectCreate):
    """创建新项目"""
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        raise HTTPException(status_code=403, detail="子账号不能创建项目")
    result = ProjectService.create_project(project.name, project.description)

    # 若用户已登录，为新项目创建完整的 createnow 预设结构
    auth = get_auth_state()
    if auth.get("logged_in"):
        ai_config = result.get("ai_config", {})
        base_url = settings.CREATENOW_BASE_URL
        auth_api_key = auth.get("api_key") or ""
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
async def list_projects(request: Request):
    """列出所有项目"""
    projects = ProjectService.list_projects()
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        user = get_user_by_username(admin_user["sub"])
        allowed = set(user.get("assigned_project_ids") or []) if user else set()
        projects = [p for p in projects if p.get("project_id") in allowed]
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
    for field in ["total_episodes", "minutes_per_episode", "compute_budget_per_minute", "project_duration_days"]:
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
    project_dir = settings.PROJECTS_DIR / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    storyboards = AssetService.list_assets(project_id, "storyboard")
    total_storyboards = len(storyboards)
    storyboards_with_image = sum(1 for s in storyboards if s.get("image_id"))

    videos_dir = project_dir / "videos"
    primary_storyboard_ids: set = set()
    total_video_seconds = 0.0
    if videos_dir.exists():
        for vf in videos_dir.glob("*.json"):
            with open(vf, encoding="utf-8") as f:
                v = _json.load(f)
            total_video_seconds += float(v.get("duration") or 0)
            if v.get("is_primary") and v.get("storyboard_id"):
                primary_storyboard_ids.add(v["storyboard_id"])

    images_dir = project_dir / "images"
    total_images = len(list(images_dir.glob("*.json"))) if images_dir.exists() else 0
    episodes = AssetService.list_assets(project_id, "episode")

    return {
        "episode_count": len(episodes),
        "total_storyboards": total_storyboards,
        "storyboards_with_image": storyboards_with_image,
        "storyboards_with_video": len(primary_storyboard_ids),
        "total_images": total_images,
        "total_video_seconds": total_video_seconds,
    }


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
