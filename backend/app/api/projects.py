from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
import uuid
from datetime import datetime

from app.services import ProjectService
from app.services.auth_service import get_auth_state
from app.core.config import settings

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str = None
    description: str = None
    ai_config: dict = None


@router.post("", response_model=dict)
async def create_project(project: ProjectCreate):
    """创建新项目"""
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

        ai_config["config_presets"] = config_presets
        ai_config["active_preset_ids"] = active_preset_ids

        ProjectService.update_project(result["project_id"], ai_config=ai_config)
        result["ai_config"] = ai_config

    return result


@router.get("", response_model=List[dict])
async def list_projects():
    """列出所有项目"""
    return ProjectService.list_projects()


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

    result = ProjectService.update_project(project_id, **update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    """删除项目"""
    success = ProjectService.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}
