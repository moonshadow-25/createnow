"""画布API - 处理画布HTTP请求与工作流运行"""
from typing import List, Optional, Dict, Any

import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.canvas_service import CanvasService
from app.services.workflow_service import WorkflowService
from app.services.user_service import get_user_by_username

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{project_id}/canvas", tags=["canvas"])


class CanvasCreate(BaseModel):
    """创建画布请求"""
    name: str = "默认画布"
    description: str = ""


class CanvasUpdate(BaseModel):
    """更新画布请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    zoom: Optional[float] = None
    pan_x: Optional[float] = None
    pan_y: Optional[float] = None
    elements: Optional[List[dict]] = None

    schema_version: Optional[int] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    variables: Optional[Dict[str, Any]] = None


class WorkflowRunCreate(BaseModel):
    trigger: str = Field(default="manual")


async def _assert_project_access(request: Request, project_id: str) -> None:
    """子账号项目级授权校验"""
    admin_user = getattr(request.state, "admin_user", None)
    if not admin_user:
        return

    if admin_user.get("role") != "user":
        return

    user = get_user_by_username(admin_user.get("sub", ""))
    allowed = set((user or {}).get("assigned_project_ids") or [])
    if project_id not in allowed:
        raise HTTPException(status_code=403, detail="无权访问该项目")


@router.get("", response_model=List[dict])
async def list_canvases(project_id: str, request: Request):
    """获取项目的所有画布列表"""
    await _assert_project_access(request, project_id)
    try:
        canvases = CanvasService.list_canvases(project_id)
        return canvases
    except Exception as e:
        logger.error(f"Failed to list canvases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=dict)
async def create_canvas(project_id: str, canvas: CanvasCreate, request: Request):
    """创建新画布"""
    await _assert_project_access(request, project_id)
    try:
        result = CanvasService.create_canvas(
            project_id=project_id,
            name=canvas.name,
            description=canvas.description,
        )
        return result
    except Exception as e:
        logger.error(f"Failed to create canvas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{canvas_id}", response_model=dict)
async def get_canvas(project_id: str, canvas_id: str, request: Request):
    """获取指定画布详情"""
    await _assert_project_access(request, project_id)
    try:
        canvas = CanvasService.get_canvas(project_id, canvas_id)
        if not canvas:
            raise HTTPException(status_code=404, detail="Canvas not found")
        return canvas
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get canvas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{canvas_id}", response_model=dict)
async def update_canvas(project_id: str, canvas_id: str, canvas: CanvasUpdate, request: Request):
    """更新画布信息"""
    await _assert_project_access(request, project_id)
    try:
        update_data = canvas.model_dump(exclude_unset=True)
        result = CanvasService.update_canvas(project_id, canvas_id, update_data)
        if not result:
            raise HTTPException(status_code=404, detail="Canvas not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update canvas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{canvas_id}")
async def delete_canvas(project_id: str, canvas_id: str, request: Request):
    """删除画布"""
    await _assert_project_access(request, project_id)
    try:
        success = CanvasService.delete_canvas(project_id, canvas_id)
        if not success:
            raise HTTPException(status_code=404, detail="Canvas not found")
        return {"message": "Canvas deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete canvas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{canvas_id}/validate", response_model=dict)
async def validate_workflow(project_id: str, canvas_id: str, request: Request):
    """校验工作流DAG结构"""
    await _assert_project_access(request, project_id)

    canvas = CanvasService.get_canvas(project_id, canvas_id)
    if not canvas:
        raise HTTPException(status_code=404, detail="Canvas not found")

    return WorkflowService.validate_canvas(canvas)


@router.post("/{canvas_id}/run", response_model=dict)
async def run_workflow(project_id: str, canvas_id: str, body: WorkflowRunCreate, request: Request):
    """创建并启动一次工作流运行"""
    await _assert_project_access(request, project_id)

    try:
        run = await WorkflowService.start_run(project_id, canvas_id, trigger=body.trigger)
        return run
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start workflow run: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{canvas_id}/runs/{run_id}/cancel", response_model=dict)
async def cancel_run(project_id: str, canvas_id: str, run_id: str, request: Request):
    """请求取消运行"""
    await _assert_project_access(request, project_id)

    try:
        return WorkflowService.request_cancel(project_id, canvas_id, run_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel run: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{canvas_id}/runs", response_model=List[dict])
async def list_runs(project_id: str, canvas_id: str, request: Request, limit: int = 50):
    """列出运行历史"""
    await _assert_project_access(request, project_id)

    try:
        return CanvasService.list_runs(project_id, canvas_id, limit=limit)
    except Exception as e:
        logger.error(f"Failed to list runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{canvas_id}/runs/{run_id}", response_model=dict)
async def get_run(project_id: str, canvas_id: str, run_id: str, request: Request):
    """获取运行详情（含事件）"""
    await _assert_project_access(request, project_id)

    run = CanvasService.get_run(project_id, canvas_id, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    run["events"] = CanvasService.list_run_events(project_id, canvas_id, run_id)
    return run
