"""
AI平台适配器基类

定义统一的接口规范，所有平台适配器必须实现这些接口
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, TYPE_CHECKING

if TYPE_CHECKING:
    import httpx


class ImageAdapter(ABC):
    """图像生成适配器接口

    所有图像生成平台（OpenAI、DashScope、Local等）必须实现此接口
    """

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        client: "httpx.AsyncClient",
        project_id: Optional[str] = None,
        log_callback: Optional[callable] = None
    ):
        """
        Args:
            api_url: API基础URL
            api_key: API密钥
            model: 模型名称
            client: HTTP客户端
            project_id: 项目ID（用于日志）
            log_callback: 日志回调函数
        """
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.client = client
        self.project_id = project_id
        self.log_callback = log_callback

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        size: str,
        negative_prompt: str = "",
        **kwargs
    ) -> Dict[str, Any]:
        """生成图片

        Args:
            prompt: 提示词
            size: 尺寸（格式因平台而异）
            negative_prompt: 负面提示词
            **kwargs: 平台特定参数

        Returns:
            {
                "success": bool,
                "image_url": str,  # 成功时
                "revised_prompt": str,  # 可选
                "error": str,  # 失败时
                ...
            }
        """
        pass

    @abstractmethod
    async def edit(
        self,
        image: str,
        prompt: str,
        size: str,
        reference_images: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """编辑图片

        Args:
            image: 主图片（URL或base64）
            prompt: 提示词
            size: 尺寸
            reference_images: 额外参考图列表
            **kwargs: 平台特定参数

        Returns:
            同 generate()
        """
        pass

    def _log(
        self,
        operation: str,
        url: str,
        method: str,
        request_payload: Dict,
        response_data: Optional[Dict] = None,
        error: Optional[str] = None,
        status_code: Optional[int] = None,
        duration_ms: Optional[float] = None
    ):
        """记录日志"""
        if self.log_callback:
            self.log_callback(
                interaction_type="image",
                operation=operation,
                url=url,
                method=method,
                request_payload=request_payload,
                response_data=response_data,
                error=error,
                status_code=status_code,
                duration_ms=duration_ms
            )


class VideoAdapter(ABC):
    """视频生成适配器接口

    所有视频生成平台必须实现此接口
    """

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        client: "httpx.AsyncClient",
        project_id: Optional[str] = None,
        log_callback: Optional[callable] = None,
        **kwargs  # 忽略子类不需要的参数（如 use_multipart）
    ):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.client = client
        self.project_id = project_id
        self.log_callback = log_callback

    @abstractmethod
    async def generate(
        self,
        image_url: str,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        **kwargs
    ) -> Dict[str, Any]:
        """创建视频生成任务

        Args:
            image_url: 输入图片URL或base64
            prompt: 提示词
            duration: 视频时长（秒）
            resolution: 分辨率
            **kwargs: 平台特定参数

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
        pass

    @abstractmethod
    async def poll(self, task_id: str) -> Dict[str, Any]:
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
        pass

    async def erase_subtitle(self, video_url: str, model: Optional[str] = None) -> Dict[str, Any]:
        """创建字幕擦除任务（默认不支持）"""
        raise NotImplementedError("Current adapter does not support subtitle removal")

    async def poll_subtitle_task(self, task_id: str) -> Dict[str, Any]:
        """轮询字幕擦除任务（默认不支持）"""
        raise NotImplementedError("Current adapter does not support subtitle removal")

    def _log(
        self,
        operation: str,
        url: str,
        method: str,
        request_payload: Dict,
        response_data: Optional[Dict] = None,
        error: Optional[str] = None,
        status_code: Optional[int] = None,
        duration_ms: Optional[float] = None
    ):
        """记录日志"""
        if self.log_callback:
            self.log_callback(
                interaction_type="video",
                operation=operation,
                url=url,
                method=method,
                request_payload=request_payload,
                response_data=response_data,
                error=error,
                status_code=status_code,
                duration_ms=duration_ms
            )


# 适配器注册表
_image_adapters: Dict[str, type] = {}
_video_adapters: Dict[str, type] = {}


def register_image_adapter(api_type: str):
    """注册图像适配器的装饰器"""
    def decorator(cls):
        _image_adapters[api_type] = cls
        return cls
    return decorator


def register_video_adapter(api_type: str):
    """注册视频适配器的装饰器"""
    def decorator(cls):
        _video_adapters[api_type] = cls
        return cls
    return decorator


def get_image_adapter(
    api_type: str,
    api_url: str,
    api_key: str,
    model: str,
    client: "httpx.AsyncClient",
    project_id: Optional[str] = None,
    log_callback: Optional[callable] = None,
    **kwargs
) -> ImageAdapter:
    """获取图像适配器实例

    Args:
        api_type: 适配器类型 ("openai", "dashscope", "local")
        其他参数传递给适配器构造函数

    Returns:
        ImageAdapter 实例

    Raises:
        ValueError: 未知的适配器类型
    """
    # 延迟导入以避免循环依赖
    from app.services.ai.adapters.openai import OpenAIImageAdapter
    from app.services.ai.adapters.dashscope import DashScopeImageAdapter
    from app.services.ai.adapters.local import LocalImageAdapter
    from app.services.ai.adapters.byteseed_image import ByteSeedImageAdapter

    adapters = {
        "openai": OpenAIImageAdapter,
        "dashscope": DashScopeImageAdapter,
        "local": LocalImageAdapter,
        "byteseed": ByteSeedImageAdapter,
    }

    adapter_cls = adapters.get(api_type)
    if not adapter_cls:
        raise ValueError(f"Unknown image adapter type: {api_type}. Available: {list(adapters.keys())}")

    return adapter_cls(
        api_url=api_url,
        api_key=api_key,
        model=model,
        client=client,
        project_id=project_id,
        log_callback=log_callback,
        **kwargs
    )


def get_video_adapter(
    api_type: str,
    api_url: str,
    api_key: str,
    model: str,
    client: "httpx.AsyncClient",
    project_id: Optional[str] = None,
    log_callback: Optional[callable] = None,
    **kwargs
) -> VideoAdapter:
    """获取视频适配器实例

    Args:
        api_type: 适配器类型 ("openai", "dashscope", "local", "byteseed")
        其他参数传递给适配器构造函数

    Returns:
        VideoAdapter 实例

    Raises:
        ValueError: 未知的适配器类型
    """
    # 延迟导入以避免循环依赖
    from app.services.ai.adapters.openai import OpenAIVideoAdapter
    from app.services.ai.adapters.dashscope import DashScopeVideoAdapter
    from app.services.ai.adapters.local import LocalVideoAdapter
    from app.services.ai.adapters.byteseed import ByteSeedVideoAdapter
    from app.services.ai.adapters.createnow import CreatenowVideoAdapter

    adapters = {
        "openai": OpenAIVideoAdapter,
        "dashscope": DashScopeVideoAdapter,
        "local": LocalVideoAdapter,
        "byteseed": ByteSeedVideoAdapter,
        "createnow": CreatenowVideoAdapter,
    }

    adapter_cls = adapters.get(api_type)
    if not adapter_cls:
        raise ValueError(f"Unknown video adapter type: {api_type}. Available: {list(adapters.keys())}")

    return adapter_cls(
        api_url=api_url,
        api_key=api_key,
        model=model,
        client=client,
        project_id=project_id,
        log_callback=log_callback,
        **kwargs
    )
