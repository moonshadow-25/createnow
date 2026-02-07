"""
AI平台适配器

支持的平台:
- OpenAI (及兼容API)
- DashScope (阿里百炼)
- Local (本地API)

扩展新平台只需:
1. 创建新的适配器类，继承 ImageAdapter 或 VideoAdapter
2. 实现抽象方法
3. 在 get_image_adapter / get_video_adapter 中注册
"""

from app.services.ai.adapters.base import (
    ImageAdapter,
    VideoAdapter,
    get_image_adapter,
    get_video_adapter,
)

__all__ = [
    "ImageAdapter",
    "VideoAdapter",
    "get_image_adapter",
    "get_video_adapter",
]
