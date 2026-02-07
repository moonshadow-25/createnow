"""
AI服务模块

提供统一的AI服务接口，支持多平台适配器：
- OpenAI (及兼容API)
- DashScope (阿里百炼)
- Local (本地API)

使用方式:
    from app.services.ai import LLMService, ImageGenService, VideoGenService
"""

from app.services.ai.base import AIService
from app.services.ai.llm import LLMService
from app.services.ai.image import ImageGenService
from app.services.ai.video import VideoGenService

__all__ = [
    "AIService",
    "LLMService",
    "ImageGenService",
    "VideoGenService",
]
