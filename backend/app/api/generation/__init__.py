"""
Generation API - 路由聚合模块

将所有生成相关的 API 端点聚合到一个路由器中。

子模块：
- image.py: 图像生成相关 API
- video.py: 视频生成相关 API
- download.py: 图片/视频下载相关 API
- prompt.py: 提示词模板管理 API
- global_style.py: 全局风格配置 API
- logs.py: AI 日志 API
"""

from fastapi import APIRouter

from .image import router as image_router
from .video import router as video_router
from .audio import router as audio_router
from .download import router as download_router
from .prompt import router as prompt_router
from .global_style import router as global_style_router
from .logs import router as logs_router
from .assets import router as assets_router

# 创建主路由器
router = APIRouter(prefix="/projects/{project_id}/generate", tags=["generation"])

# 注意：下载相关路由必须在视频路由之前注册
# 因为 /videos/download-all 等路径会被 /videos/{video_id} 匹配
router.include_router(download_router)
router.include_router(image_router)
router.include_router(video_router)
router.include_router(audio_router)
router.include_router(prompt_router)
router.include_router(global_style_router)
router.include_router(logs_router)
router.include_router(assets_router)

# 导出模板供外部使用
from .templates import DEFAULT_PROMPT_TEMPLATES

__all__ = ["router", "DEFAULT_PROMPT_TEMPLATES"]
