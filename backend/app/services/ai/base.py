"""
AI服务基类

提供通用的HTTP客户端、请求头构建、日志记录等功能
"""

import httpx
import logging
import re
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class AIService:
    """AI服务基类，处理OpenAI兼容API"""

    def __init__(self, api_url: str, api_key: str, model: str, project_id: Optional[str] = None):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.project_id = project_id
        self.client = httpx.AsyncClient(timeout=120.0)

    async def close(self):
        await self.client.aclose()

    def _get_headers(
        self,
        extra_headers: Optional[Dict[str, str]] = None,
        exclude_content_type: bool = False
    ) -> Dict[str, str]:
        """构建请求头

        Args:
            extra_headers: 额外的请求头字典
            exclude_content_type: 是否排除 Content-Type 头（用于 multipart/form-data 请求）

        Returns:
            请求头字典
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }

        # 只在不排除时添加 Content-Type
        if not exclude_content_type:
            headers["Content-Type"] = "application/json"

        # 添加额外的请求头
        if extra_headers:
            headers.update(extra_headers)

        return headers

    def _truncate_base64(self, data: Any, max_length: int = 200) -> Any:
        """截断base64数据，避免日志过大"""
        if isinstance(data, str):
            # 检测是否是base64字符串（通常很长且包含特定字符）
            if len(data) > 500 and re.match(r'^[A-Za-z0-9+/=]+$', data):
                return f"{data[:max_length]}...[truncated {len(data)} chars]...{data[-max_length:]}"
            return data
        elif isinstance(data, dict):
            return {k: self._truncate_base64(v, max_length) for k, v in data.items()}
        elif isinstance(data, list):
            return [self._truncate_base64(item, max_length) for item in data]
        return data

    def _sanitize_headers(self, headers: Dict[str, str]) -> Dict[str, str]:
        """清理headers，隐藏敏感信息"""
        sanitized = headers.copy()
        if "Authorization" in sanitized:
            sanitized["Authorization"] = "Bearer ***"
        return sanitized

    def _log_interaction(
        self,
        interaction_type: str,
        operation: str,
        url: str,
        method: str,
        request_payload: Dict,
        response_data: Optional[Dict] = None,
        error: Optional[str] = None,
        duration_ms: Optional[float] = None,
        status_code: Optional[int] = None
    ):
        """记录AI交互日志"""
        if not self.project_id:
            return

        try:
            from app.services.ai_log_service import AILogService

            # 截断base64数据
            truncated_request = self._truncate_base64(request_payload)
            truncated_response = self._truncate_base64(response_data) if response_data else None

            AILogService.log_interaction(
                project_id=self.project_id,
                interaction_type=interaction_type,
                request_data={
                    "url": url,
                    "method": method,
                    "payload": truncated_request,
                },
                response_data={
                    "status_code": status_code,
                    "body": truncated_response,
                    "duration_ms": duration_ms
                } if response_data else None,
                error=error,
                metadata={
                    "model": self.model,
                    "api_url": self.api_url,
                    "operation": operation
                }
            )
        except Exception as e:
            logger.error(f"Failed to log AI interaction: {e}")
