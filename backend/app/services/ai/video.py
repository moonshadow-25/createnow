"""
视频生成服务

提供统一的视频生成接口，内部使用适配器模式支持多平台
"""

import logging
from typing import Optional, Dict, Any

from app.services.ai.base import AIService
from app.services.ai.adapters import get_video_adapter
from app.services.ai.utils.image_processor import ImageProcessor

logger = logging.getLogger(__name__)


class VideoGenService(AIService):
    """图生视频服务 - 支持OpenAI、阿里百炼、字节Seed和本地API"""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        api_type: str = "openai",
        use_multipart: bool = True,
        project_id: Optional[str] = None,
        generate_audio: bool = False,
        watermark: bool = False
    ):
        """
        Args:
            api_url: API基础URL
            api_key: API密钥
            model: 默认模型名称
            api_type: API类型 ("openai", "dashscope", "local", "byteseed")
            use_multipart: 是否使用multipart/form-data格式（仅OpenAI/Local）
            project_id: 项目ID（用于日志记录）
            generate_audio: 是否生成音频（ByteSeed）
            watermark: 是否添加水印（ByteSeed）
        """
        super().__init__(api_url, api_key, model, project_id)
        self.api_type = api_type
        self.use_multipart = use_multipart
        self.generate_audio = generate_audio
        self.watermark = watermark
        self._adapter = None

    def _get_adapter(self):
        """获取或创建适配器实例"""
        if self._adapter is None:
            self._adapter = get_video_adapter(
                api_type=self.api_type,
                api_url=self.api_url,
                api_key=self.api_key,
                model=self.model,
                client=self.client,
                project_id=self.project_id,
                log_callback=self._log_interaction,
                use_multipart=self.use_multipart,
                generate_audio=self.generate_audio,
                watermark=self.watermark
            )
        return self._adapter

    @staticmethod
    def scale_image_to_1080p(image_url: str) -> str:
        """将图片缩放到1080p（短边=1080）

        Args:
            image_url: 图片URL（支持 http(s):// 或 data:image/...;base64,... 格式）

        Returns:
            缩放后的base64格式图片 (data:image/jpeg;base64,...)
        """
        return ImageProcessor.scale_to_1080p(image_url)

    async def generate(
        self,
        image_url: str,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        ratio: Optional[str] = None,
        model: Optional[str] = None,
        use_multipart: Optional[bool] = None
    ) -> Dict[str, Any]:
        """生成视频

        Args:
            image_url: 输入图片URL或base64
            prompt: 提示词
            duration: 视频时长（秒）
            resolution: 分辨率
            model: 指定模型（覆盖默认）
            use_multipart: 是否使用multipart格式（覆盖默认）

        Returns:
            {
                "success": bool,
                "task_id": str,  # 成功时
                "status": str,  # pending/in_progress/completed/failed
                "error": str,  # 失败时
                "raw_create_response": dict,  # 原始响应
                ...
            }
        """
        adapter = self._get_adapter()
        return await adapter.generate(
            image_url=image_url,
            prompt=prompt,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            model=model,
            use_multipart=use_multipart if use_multipart is not None else self.use_multipart
        )

    async def generate_multi_image(
        self,
        image_urls: list,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        ratio: Optional[str] = None,
        model: Optional[str] = None,
        use_multipart: Optional[bool] = None
    ) -> Dict[str, Any]:
        """生成视频（多图模式，首尾帧）

        Args:
            image_urls: 输入图片URL或base64列表（2张：首帧+尾帧）
            prompt: 提示词
            duration: 视频时长（秒）
            resolution: 分辨率
            model: 指定模型（覆盖默认）
            use_multipart: 是否使用multipart格式（覆盖默认）

        Returns:
            {
                "success": bool,
                "task_id": str,  # 成功时
                "status": str,  # pending/in_progress/completed/failed
                "error": str,  # 失败时
                "raw_create_response": dict,  # 原始响应
                ...
            }
        """
        adapter = self._get_adapter()
        return await adapter.generate_multi_image(
            image_urls=image_urls,
            prompt=prompt,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            model=model,
            use_multipart=use_multipart if use_multipart is not None else self.use_multipart
        )

    async def generate_multimodal(
        self,
        prompt: str,
        image_urls: list = None,
        video_urls: list = None,
        audio_urls: list = None,
        duration: int = 6,
        resolution: str = "1920x1080",
        ratio: str = None,
        use_web_search: bool = False,
        model: Optional[str] = None,
        bitrate_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """生成视频（多模态模式，支持图片+视频+音频参考）"""
        adapter = self._get_adapter()
        return await adapter.generate_multimodal(
            prompt=prompt,
            image_urls=image_urls,
            video_urls=video_urls,
            audio_urls=audio_urls,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            use_web_search=use_web_search,
            model=model,
            bitrate_mode=bitrate_mode,
        )

    async def poll_video_task(self, task_id: str) -> Dict[str, Any]:
        """轮询视频生成任务状态

        Args:
            task_id: 任务ID

        Returns:
            {
                "success": bool,
                "status": str,  # pending/in_progress/completed/failed
                "video_url": str,  # 完成时
                "error": str,  # 失败时
                "raw_poll_response": dict,  # 原始响应
                ...
            }
        """
        logger.info(f"poll_video_task called: task_id={task_id}, api_type={self.api_type}")
        adapter = self._get_adapter()
        return await adapter.poll(task_id)

    async def erase_subtitle(self, video_url: str, model: Optional[str] = None) -> Dict[str, Any]:
        """创建字幕擦除任务（由支持该能力的平台适配器实现）"""
        adapter = self._get_adapter()
        return await adapter.erase_subtitle(video_url=video_url, model=model)

    async def poll_subtitle_task(self, task_id: str) -> Dict[str, Any]:
        """轮询字幕擦除任务（由支持该能力的平台适配器实现）"""
        adapter = self._get_adapter()
        return await adapter.poll_subtitle_task(task_id=task_id)
