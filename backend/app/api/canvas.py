"""画布API - 处理画布的HTTP请求"""
from fastapi import APIRouter, HTTPException
from typing import List, Optional
from pydantic import BaseModel
import logging

from app.services.canvas_service import CanvasService

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


@router.get("", response_model=List[dict])
async def list_canvases(project_id: str):
    """获取项目的所有画布列表"""
    try:
        canvases = CanvasService.list_canvases(project_id)
        return canvases
    except Exception as e:
        logger.error(f"Failed to list canvases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=dict)
async def create_canvas(project_id: str, canvas: CanvasCreate):
    """创建新画布"""
    try:
        result = CanvasService.create_canvas(
            project_id=project_id,
            name=canvas.name,
            description=canvas.description
        )
        return result
    except Exception as e:
        logger.error(f"Failed to create canvas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{canvas_id}", response_model=dict)
async def get_canvas(project_id: str, canvas_id: str):
    """获取指定画布详情"""
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
async def update_canvas(project_id: str, canvas_id: str, canvas: CanvasUpdate):
    """更新画布信息"""
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
async def delete_canvas(project_id: str, canvas_id: str):
    """删除画布"""
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
