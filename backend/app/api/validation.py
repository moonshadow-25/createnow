from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, Literal

from app.services.validation_service import ValidationService
from app.services import AILogService

router = APIRouter(prefix="/validate", tags=["validation"])


class LLMValidationRequest(BaseModel):
    api_url: str
    api_key: str
    model: str
    api_type: Optional[Literal["openai", "dashscope"]] = "openai"


class ImageValidationRequest(BaseModel):
    api_url: str
    api_key: str
    model: str
    api_type: Optional[Literal["openai", "dashscope"]] = "openai"
    image_edit_model: Optional[str] = None


class VideoValidationRequest(BaseModel):
    api_url: str
    api_key: str
    model: str
    api_type: Optional[Literal["openai", "dashscope"]] = "openai"


class TTSValidationRequest(BaseModel):
    api_url: str
    api_key: str
    model: str
    api_type: Optional[Literal["openai", "dashscope", "local"]] = "openai"
    voice: Optional[str] = None
    id: Optional[str] = None


@router.post("/llm")
async def validate_llm(request: LLMValidationRequest) -> Dict[str, Any]:
    """验证LLM API配置"""
    result = await ValidationService.validate_llm_api(
        request.api_url,
        request.api_key,
        request.model,
        request.api_type
    )
    return result


@router.post("/image")
async def validate_image(request: ImageValidationRequest) -> Dict[str, Any]:
    """验证图片生成API配置"""
    result = await ValidationService.validate_image_api(
        request.api_url,
        request.api_key,
        request.model,
        request.api_type,
        request.image_edit_model
    )

    # 记录验证日志到"测试"项目，方便在前端查看
    AILogService.log_interaction(
        project_id="ed56d45b-eb3e-48ff-bfbd-dabf4981f8c3",  # 测试项目ID
        interaction_type=AILogService.TYPE_IMAGE,
        request_data={
            "operation": "validate_image",
            "api_type": request.api_type,
            "model": request.model,
            "image_edit_model": request.image_edit_model,
            "api_url": request.api_url
        },
        response_data={
            "valid": result.get("valid"),
            "message": result.get("message")
        },
        error=result.get("error") if not result.get("valid") else None,
        metadata={
            "operation": "validate_image",
            "request_sent": result.get("request_sent", {}),
            "api_response": result.get("response", {})
        }
    )

    return result


@router.post("/video")
async def validate_video(request: VideoValidationRequest) -> Dict[str, Any]:
    """验证视频生成API配置"""
    result = await ValidationService.validate_video_api(
        request.api_url,
        request.api_key,
        request.model,
        request.api_type
    )
    return result


@router.post("/tts")
async def validate_tts(request: TTSValidationRequest) -> Dict[str, Any]:
    """验证TTS API配置"""
    result = await ValidationService.validate_tts_api(
        request.api_url,
        request.api_key,
        request.model,
        request.api_type,
        request.voice,
        request.id
    )
    return result
