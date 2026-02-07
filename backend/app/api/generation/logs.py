"""
Generation API - AI 日志相关端点
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.services import AILogService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/ai-logs")
async def get_ai_logs(
    project_id: str,
    type: Optional[str] = Query(None, description="日志类型: llm/image/video"),
    limit: int = Query(100, description="返回条数限制"),
    offset: int = Query(0, description="偏移量")
):
    """获取项目的AI交互日志"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    logs = AILogService.get_logs(
        project_id=project_id,
        interaction_type=type,
        limit=limit,
        offset=offset
    )

    total = AILogService.get_log_count(project_id, interaction_type=type)

    return {
        "logs": logs,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.delete("/ai-logs")
async def clear_ai_logs(
    project_id: str,
    type: Optional[str] = Query(None, description="要清除的日志类型，不传则清除全部")
):
    """清除项目的AI交互日志"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = AILogService.clear_logs(project_id, interaction_type=type)

    return {
        "success": True,
        "deleted": result["deleted"]
    }
