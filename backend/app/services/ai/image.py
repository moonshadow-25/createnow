"""
图像生成服务

提供统一的图像生成接口，内部使用适配器模式支持多平台
"""

import logging
from typing import Optional, Dict, Any, List

from app.services.ai.base import AIService
from app.services.ai.adapters import get_image_adapter

logger = logging.getLogger(__name__)


class ImageGenService(AIService):
    """图像生成服务 - 支持OpenAI、阿里百炼和本地API"""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        api_type: str = "openai",
        project_id: Optional[str] = None,
        image_edit_model: Optional[str] = None,
        max_images: int = 1,
        watermark: bool = False
    ):
        """
        Args:
            api_url: API基础URL
            api_key: API密钥
            model: 默认模型名称
            api_type: API类型 ("openai", "dashscope", "local", "byteseed")
            project_id: 项目ID（用于日志记录）
            image_edit_model: 图像编辑专用模型（可选）
            max_images: 多图生成数量（ByteSeed专用，1-4）
            watermark: 是否添加水印（ByteSeed专用）
        """
        super().__init__(api_url, api_key, model, project_id)
        self.api_type = api_type
        self.image_edit_model = image_edit_model
        self.max_images = max_images
        self.watermark = watermark
        self._adapter = None

    def _get_adapter(self):
        """获取或创建适配器实例"""
        if self._adapter is None:
            self._adapter = get_image_adapter(
                api_type=self.api_type,
                api_url=self.api_url,
                api_key=self.api_key,
                model=self.model,
                client=self.client,
                project_id=self.project_id,
                log_callback=self._log_interaction,
                image_edit_model=self.image_edit_model,
                max_images=self.max_images,
                watermark=self.watermark
            )
        return self._adapter

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        size_str: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """生成图片

        Args:
            prompt: 提示词
            negative_prompt: 负面提示词
            width: 像素宽度
            height: 像素高度
            size_str: 原始尺寸字符串 (如 "1x1", "16x9")，用于某些API的比例格式
            model: 指定模型（覆盖默认）

        Returns:
            {
                "success": bool,
                "image_url": str,  # 成功时
                "revised_prompt": str,  # 可选
                "error": str,  # 失败时
                ...
            }
        """
        adapter = self._get_adapter()

        # 根据 api_type 决定 size 格式
        if self.api_type == "dashscope":
            # DashScope 使用像素格式 "width*height"
            size = f"{width}*{height}"
        else:
            # OpenAI/Local 使用比例格式或像素格式
            size = size_str if size_str else f"{width}x{height}"

        return await adapter.generate(
            prompt=prompt,
            size=size,
            negative_prompt=negative_prompt,
            model=model
        )

    async def edit(
        self,
        image_path: str,
        prompt: str,
        size: str = "1x1",
        width: int = 1536,
        height: int = 1536,
        model: Optional[str] = None,
        reference_images: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """编辑图片

        Args:
            image_path: 主图片路径/URL/base64
            prompt: 编辑提示词
            size: 尺寸字符串（比例格式如 "1x1", "16x9"，用于 OpenAI）
            width: 像素宽度（用于 DashScope）
            height: 像素高度（用于 DashScope）
            model: 指定模型（覆盖默认）
            reference_images: 额外参考图列表

        Returns:
            同 generate()
        """
        adapter = self._get_adapter()
        return await adapter.edit(
            image=image_path,
            prompt=prompt,
            size=size,
            width=width,
            height=height,
            reference_images=reference_images,
            model=model
        )
