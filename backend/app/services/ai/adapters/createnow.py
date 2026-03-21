"""
CreateNow 官方平台适配器

CreateNow API 与字节 Seed 完全兼容，直接继承 ByteSeedVideoAdapter
"""

import logging
from typing import Optional

from app.services.ai.adapters.byteseed import ByteSeedVideoAdapter

logger = logging.getLogger(__name__)


class CreatenowVideoAdapter(ByteSeedVideoAdapter):
    """CreateNow 视频生成适配器

    CreateNow API 格式与字节 Seed 完全一致，包括：
    - generate() 单图模式
    - generate_multi_image() 多图模式（首尾帧）
    - generate_multimodal() 多模态模式（全能参考）
    - poll() 任务轮询

    所有参数格式、响应格式、状态映射均与 ByteSeedVideoAdapter 相同
    """

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        client,
        project_id: Optional[str] = None,
        log_callback: Optional[callable] = None,
        generate_audio: bool = False,
        watermark: bool = False,
        **kwargs
    ):
        """
        Args:
            api_url: CreateNow API 基础 URL
            api_key: API 密钥
            model: 模型名称（如 nova-pro）
            client: httpx.AsyncClient 实例
            project_id: 项目 ID（用于日志记录）
            log_callback: 日志回调函数
            generate_audio: 是否生成音频
            watermark: 是否添加水印
        """
        super().__init__(
            api_url=api_url,
            api_key=api_key,
            model=model,
            client=client,
            project_id=project_id,
            log_callback=log_callback,
            generate_audio=generate_audio,
            watermark=watermark,
            **kwargs
        )
