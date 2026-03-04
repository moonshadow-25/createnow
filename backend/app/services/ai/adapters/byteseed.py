"""
字节Seed (ByteDance Seed) 平台适配器

支持字节跳动 Seed API 的视频生成
API文档: https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.adapters.base import VideoAdapter

logger = logging.getLogger(__name__)


class ByteSeedVideoAdapter(VideoAdapter):
    """字节Seed视频生成适配器"""

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
            api_url: API基础URL (https://ark.cn-beijing.volces.com/api/v3)
            api_key: API密钥
            model: 模型名称 (如 doubao-seedance-1-5-pro-251215)
            client: httpx.AsyncClient实例
            project_id: 项目ID（用于日志记录）
            log_callback: 日志回调函数
            generate_audio: 是否生成音频
            watermark: 是否添加水印
        """
        super().__init__(api_url, api_key, model, client, project_id, log_callback)
        self.generate_audio = generate_audio
        self.watermark = watermark

    async def generate(
        self,
        image_url: str,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        **kwargs
    ) -> Dict[str, Any]:
        """单图模式 - 图生视频（首帧）

        Args:
            image_url: 输入图片URL或base64
            prompt: 提示词
            duration: 视频时长（秒）
            resolution: 分辨率（如 "1920x1080"）
            **kwargs: 其他参数（model, generate_audio等）

        Returns:
            {
                "success": bool,
                "task_id": str,  # 成功时
                "status": str,  # pending/in_progress/completed/failed
                "error": str,  # 失败时
                "raw_create_response": dict,  # 原始响应
            }
        """
        content = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {"url": image_url}
                # 首帧模式不指定role
            }
        ]

        ratio = self._map_resolution_to_ratio(resolution)
        return await self._create_task(content, duration, ratio, **kwargs)

    async def generate_multi_image(
        self,
        image_urls: list,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        **kwargs
    ) -> Dict[str, Any]:
        """多图模式 - 首尾帧或参考图

        Args:
            image_urls: 输入图片URL或base64列表
            prompt: 提示词
            duration: 视频时长（秒）
            resolution: 分辨率（如 "1920x1080"）
            **kwargs: 其他参数（model, generate_audio等）

        Returns:
            {
                "success": bool,
                "task_id": str,  # 成功时
                "status": str,  # pending/in_progress/completed/failed
                "error": str,  # 失败时
                "raw_create_response": dict,  # 原始响应
            }
        """
        content = [{"type": "text", "text": prompt}]

        if len(image_urls) == 2:
            # 首尾帧模式
            content.append({
                "type": "image_url",
                "image_url": {"url": image_urls[0]},
                "role": "first_frame"
            })
            content.append({
                "type": "image_url",
                "image_url": {"url": image_urls[1]},
                "role": "last_frame"
            })
            ratio = self._map_resolution_to_ratio(resolution)
        else:
            # 参考图模式（3张及以上）
            for img_url in image_urls:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": img_url},
                    "role": "reference_image"
                })
            ratio = "adaptive"  # 参考图模式使用adaptive

        return await self._create_task(content, duration, ratio, **kwargs)

    async def _create_task(
        self,
        content: list,
        duration: int,
        ratio: str,
        **kwargs
    ) -> Dict[str, Any]:
        """创建视频生成任务

        Args:
            content: content数组（包含text和image_url）
            duration: 视频时长（秒）
            ratio: 比例（16:9, 9:16, 1:1等）
            **kwargs: 其他参数

        Returns:
            统一格式的响应
        """
        url = f"{self.api_url}/contents/generations/tasks"

        payload = {
            "model": kwargs.get("model") or self.model,
            "content": content,
            "ratio": ratio,
            "resolution": "1080p",  # 固定值
            "duration": duration,
            "watermark": self.watermark,
            "generate_audio": kwargs.get("generate_audio", self.generate_audio)
        }

        # 创建截断版本用于日志（避免base64过大）
        payload_for_log = self._truncate_payload_for_log(payload)

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检查HTTP错误
            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self._log(
                    operation="video_generate",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "payload": payload_for_log},
                        "status_code": response.status_code,
                        "response_text": response.text
                    }
                }

            data = response.json()

            # 检查API错误响应
            if "error" in data:
                error_msg = data.get("error", {}).get("message", "Unknown error")
                self._log(
                    operation="video_generate",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    response_data=data,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": f"ByteSeed API Error: {error_msg}",
                    "raw_create_response": data
                }

            # 提取task_id
            task_id = data.get("id")
            if not task_id:
                error_msg = "API did not return a task ID"
                self._log(
                    operation="video_generate",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    response_data=data,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "raw_create_response": data
                }

            logger.info(f"[ByteSeed] Video task created: task_id={task_id}")

            self._log(
                operation="video_generate",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": "pending",
                "raw_create_response": data
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"ByteSeed API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="video_generate",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "status": "failed",
                "error": error_msg
            }

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
            }
        """
        url = f"{self.api_url}/contents/generations/tasks/{task_id}"

        start_time = datetime.now()

        try:
            response = await self.client.get(
                url,
                headers=self._get_headers(),
                timeout=30.0
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检查HTTP错误
            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self._log(
                    operation="video_poll",
                    url=url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": {
                        "status_code": response.status_code,
                        "response_text": response.text
                    }
                }

            data = response.json()

            # 检查API错误响应
            if "error" in data:
                error_msg = data.get("error", {}).get("message", "Unknown error")
                self._log(
                    operation="video_poll",
                    url=url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=data,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": f"ByteSeed API Error: {error_msg}",
                    "task_id": task_id,
                    "raw_poll_response": data
                }

            # 映射状态
            seed_status = data.get("status", "")
            status = self._map_status(seed_status)

            # 记录日志
            self._log(
                operation="video_poll",
                url=url,
                method="GET",
                request_payload={"task_id": task_id},
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            # 根据状态返回不同结果
            if status == "completed":
                video_url = data.get("content", {}).get("video_url")
                if not video_url:
                    return {
                        "success": False,
                        "status": "failed",
                        "error": "No video URL in completed response",
                        "task_id": task_id,
                        "raw_poll_response": data
                    }

                logger.info(f"[ByteSeed] Video task completed: task_id={task_id}")
                return {
                    "success": True,
                    "status": "completed",
                    "video_url": video_url,
                    "task_id": task_id,
                    "raw_poll_response": data
                }

            elif status == "failed":
                error_msg = data.get("error_message") or data.get("message") or "Unknown error"
                logger.warning(f"[ByteSeed] Video task failed: task_id={task_id}, error={error_msg}")
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": data
                }

            else:
                # pending 或 in_progress
                return {
                    "success": True,
                    "status": status,
                    "task_id": task_id,
                    "raw_poll_response": data
                }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"ByteSeed Poll Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="video_poll",
                url=url,
                method="GET",
                request_payload={"task_id": task_id},
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "status": "failed",
                "error": error_msg,
                "task_id": task_id
            }

    def _map_resolution_to_ratio(self, resolution: str) -> str:
        """分辨率转比例

        Args:
            resolution: 分辨率字符串（如 "1920x1080"）

        Returns:
            比例字符串（如 "16:9"）
        """
        ratio_map = {
            "1920x1080": "16:9",
            "1080x1920": "9:16",
            "1280x720": "16:9",
            "720x1280": "9:16",
            "1024x1024": "1:1",
            "1440x1080": "4:3",
            "1080x1440": "3:4",
            "2560x1080": "21:9",
        }
        return ratio_map.get(resolution, "16:9")

    def _map_status(self, seed_status: str) -> str:
        """状态映射

        Args:
            seed_status: ByteSeed API返回的状态

        Returns:
            统一的状态字符串（pending/in_progress/completed/failed）
        """
        status_map = {
            "pending": "pending",
            "processing": "in_progress",
            "running": "in_progress",
            "succeeded": "completed",
            "completed": "completed",
            "failed": "failed",
            "error": "failed",
        }
        return status_map.get(seed_status.lower(), "pending")

    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def _truncate_payload_for_log(self, payload: dict) -> dict:
        """截断payload中的base64数据用于日志"""
        truncated = payload.copy()

        if "content" in truncated:
            truncated_content = []
            for item in truncated["content"]:
                item_copy = item.copy()
                if item.get("type") == "image_url":
                    url = item.get("image_url", {}).get("url", "")
                    if url.startswith("data:image") and len(url) > 200:
                        # 截断base64
                        item_copy["image_url"] = {
                            "url": f"{url[:100]}...[truncated {len(url)} chars]...{url[-50:]}"
                        }
                        if "role" in item:
                            item_copy["role"] = item["role"]
                truncated_content.append(item_copy)
            truncated["content"] = truncated_content

        return truncated
