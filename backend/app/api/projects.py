from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

from app.services import ProjectService

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
