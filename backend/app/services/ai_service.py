"""
AI服务模块 - 向后兼容入口

此文件作为门面（Facade），保持原有导入方式有效：
    from app.services.ai_service import AIService, LLMService, ImageGenService, VideoGenService

实际实现已拆分到 app.services.ai 子模块：
    - app.services.ai.base        - AIService 基类
    - app.services.ai.llm         - LLMService 大语言模型服务
    - app.services.ai.image       - ImageGenService 图像生成服务
    - app.services.ai.video       - VideoGenService 视频生成服务
    - app.services.ai.adapters    - 平台适配器（OpenAI、DashScope、Local）
    - app.services.ai.utils       - 工具函数（图片处理等）

扩展新平台：
    1. 在 app.services.ai.adapters 目录创建新适配器
    2. 实现 ImageAdapter 或 VideoAdapter 接口
    3. 在 adapters/base.py 的工厂函数中注册

原文件已备份至 ai_service_backup.py
"""

import logging
from typing import Dict, Optional

from app.core.config import settings

# 从新模块导入所有类，保持向后兼容
from app.services.ai.base import AIService
from app.services.ai.llm import LLMService
from app.services.ai.image import ImageGenService
from app.services.ai.video import VideoGenService

logger = logging.getLogger(__name__)


def get_ai_service(project_config: Dict, service_type: str, project_id: Optional[str] = None) -> AIService:
    """根据项目配置获取AI服务实例

    Args:
        project_config: 项目配置字典
        service_type: 服务类型 ("llm", "vlm", "image", "video")
        project_id: 项目ID，用于日志记录

    Returns:
        对应的AI服务实例
    """
    config = project_config.get(service_type, {})

    api_url = config.get("api_url") or getattr(settings, f"DEFAULT_{service_type.upper()}_API_URL")
    api_key = config.get("api_key") or getattr(settings, f"DEFAULT_{service_type.upper()}_API_KEY")
    model = config.get("model") or getattr(settings, f"DEFAULT_{service_type.upper()}_MODEL")
    api_type = config.get("api_type", "openai")  # 默认使用OpenAI格式

    # CreateNow 官方接口：强制使用官方 URL，从 global.json 读取 API Key
    if api_type == "createnow":
        from app.services.auth_service import get_auth_state
        api_url = settings.CREATENOW_BASE_URL
        auth_state = get_auth_state()
        api_key = auth_state.get("api_key") or api_key
        # 只有视频服务区分全能参考（走 CreatenowVideoAdapter），其余服务始终走 OpenAI 兼容接口
        if service_type == "video":
            multimodal_reference = config.get("multimodal_reference", False)
            if not multimodal_reference:
                api_type = "openai"
        else:
            api_type = "openai"

    logger.info(f"[AI Service] Initializing {service_type} service:")
    logger.info(f"  - api_type: {api_type}")
    logger.info(f"  - api_url: {api_url}")
    logger.info(f"  - model: {model}")

    if service_type == "llm":
        return LLMService(api_url, api_key, model, project_id)
    elif service_type == "vlm":
        # VLM 本质上也是 LLM，只是使用不同的配置（支持图片理解的模型）
        return LLMService(api_url, api_key, model, project_id)
    elif service_type == "image":
        # 阿里百炼需要额外的图像编辑模型
        image_edit_model = config.get("image_edit_model") or settings.DASHSCOPE_IMAGE_EDIT_MODEL
        max_images = config.get("max_images", 1)  # ByteSeed多图生成（1-4）
        watermark = config.get("watermark", False)  # ByteSeed水印
        return ImageGenService(
            api_url=api_url,
            api_key=api_key,
            model=model,
            api_type=api_type,
            project_id=project_id,
            image_edit_model=image_edit_model,
            max_images=max_images,
            watermark=watermark
        )
    elif service_type == "video":
        use_multipart = config.get("use_multipart", True)  # 从配置读取，默认True（使用文件上传）
        generate_audio = config.get("generate_audio", False)  # 是否生成音频（ByteSeed）
        watermark = config.get("watermark", False)  # 是否添加水印（ByteSeed）
        return VideoGenService(
            api_url=api_url,
            api_key=api_key,
            model=model,
            api_type=api_type,
            use_multipart=use_multipart,
            project_id=project_id,
            generate_audio=generate_audio,
            watermark=watermark
        )
    else:
        raise ValueError(f"Unknown service type: {service_type}")


# 导出所有公共类和函数
__all__ = [
    "AIService",
    "LLMService",
    "ImageGenService",
    "VideoGenService",
    "get_ai_service",
]
