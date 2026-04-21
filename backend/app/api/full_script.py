"""全剧本导入API — 分集 / 资产提取 / 分集并提取"""
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.asset_service import ProjectService
from app.services.full_script_service import (
    split_into_episodes,
    extract_all_assets,
    split_and_extract,
    stream_split_and_extract,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/full-script", tags=["full-script"])


class FullScriptRequest(BaseModel):
    content: str  # 完整剧本文本


@router.post("/split-episodes")
async def api_split_episodes(project_id: str, request: FullScriptRequest):
    """AI 一键分集：将完整剧本自动分集，创建或更新 Episode 资产"""
    if not request.content.strip():
        raise HTTPException(status_code=422, detail="剧本内容不能为空")

    try:
        project = ProjectService.get_project(project_id)
        ai_config = project.get("ai_config", {}) if project else {}
        result = await split_into_episodes(project_id, request.content, ai_config)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[FullScript] split-episodes failed: {e}")
        raise HTTPException(status_code=500, detail=f"分集处理失败: {str(e)}")


@router.post("/extract-assets")
async def api_extract_assets(project_id: str, request: FullScriptRequest):
    """AI 提取全部资产：从完整剧本中提取角色/场景/道具"""
    if not request.content.strip():
        raise HTTPException(status_code=422, detail="剧本内容不能为空")

    try:
        project = ProjectService.get_project(project_id)
        ai_config = project.get("ai_config", {}) if project else {}
        result = await extract_all_assets(project_id, request.content, ai_config)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[FullScript] extract-assets failed: {e}")
        raise HTTPException(status_code=500, detail=f"资产提取失败: {str(e)}")


@router.post("/split-and-extract")
async def api_split_and_extract(project_id: str, request: FullScriptRequest):
    """AI 分集并提取：保持旧非流式行为（兼容）"""
    if not request.content.strip():
        raise HTTPException(status_code=422, detail="剧本内容不能为空")

    try:
        project = ProjectService.get_project(project_id)
        ai_config = project.get("ai_config", {}) if project else {}
        result = await split_and_extract(project_id, request.content, ai_config)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[FullScript] split-and-extract failed: {e}")
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")


@router.post("/split-and-extract-stream")
async def api_split_and_extract_stream(project_id: str, request: FullScriptRequest):
    """AI 分集并提取：流式进度接口（SSE）"""
    if not request.content.strip():
        raise HTTPException(status_code=422, detail="剧本内容不能为空")

    try:
        project = ProjectService.get_project(project_id)
        ai_config = project.get("ai_config", {}) if project else {}

        async def _event_stream():
            async for event in stream_split_and_extract(project_id, request.content, ai_config):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        return StreamingResponse(_event_stream(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[FullScript] split-and-extract-stream failed: {e}")
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")
