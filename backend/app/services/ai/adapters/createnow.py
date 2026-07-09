"""
CreateNow 官方平台适配器

CreateNow API 与字节 Seed 完全兼容，直接继承 ByteSeedVideoAdapter
"""

import logging
from datetime import datetime
from typing import Optional, Dict, Any

from app.core.config import settings
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

    @staticmethod
    def _extract_subtitle_video_url(data: Dict[str, Any]) -> str:
        result = data.get("result") or {}
        nested_data = data.get("data") or {}
        for container in (result, nested_data, data):
            video_url = str(container.get("video_url") or container.get("url") or "").strip()
            if video_url:
                return video_url
        return ""

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

    async def erase_subtitle(self, video_url: str, model: Optional[str] = None) -> Dict[str, Any]:
        """创建字幕擦除任务（CreateNow 官方接口）"""
        url = f"https://{settings.CREATENOW_OFFICIAL_HOST}{settings.CREATENOW_SUBTITLE_SUBMIT_PATH}"
        selected_model = (model or "").strip() or settings.CREATENOW_SUBTITLE_MODEL_ID

        start_time = datetime.now()
        payload = {"video_url": video_url, "model": selected_model}

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload,
                timeout=60.0,
            )
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self._log(
                    operation="video_subtitle_erase_submit",
                    url=url,
                    method="POST",
                    request_payload=payload,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                }

            data = response.json()
            if not data.get("success"):
                err = data.get("error") or {}
                error_msg = err.get("message") or "CreateNow subtitle erase submit failed"
                self._log(
                    operation="video_subtitle_erase_submit",
                    url=url,
                    method="POST",
                    request_payload=payload,
                    response_data=data,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                }

            task_id = data.get("task_id") or data.get("id")
            if not task_id:
                error_msg = "CreateNow subtitle erase submit succeeded but task_id is missing"
                self._log(
                    operation="video_subtitle_erase_submit",
                    url=url,
                    method="POST",
                    request_payload=payload,
                    response_data=data,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                )
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                }

            self._log(
                operation="video_subtitle_erase_submit",
                url=url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms,
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": "pending",
                "raw_create_response": data,
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"CreateNow subtitle erase submit error: {str(e)}"
            self._log(
                operation="video_subtitle_erase_submit",
                url=url,
                method="POST",
                request_payload=payload,
                error=error_msg,
                duration_ms=duration_ms,
            )
            return {
                "success": False,
                "status": "failed",
                "error": error_msg,
            }

    async def poll_subtitle_task(self, task_id: str) -> Dict[str, Any]:
        """轮询字幕擦除任务状态（CreateNow 官方接口）"""
        path = settings.CREATENOW_SUBTITLE_POLL_PATH.format(task_id=task_id)
        url = f"https://{settings.CREATENOW_OFFICIAL_HOST}{path}"

        start_time = datetime.now()

        try:
            response = await self.client.get(
                url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
            )
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                raw_poll_response = {
                    "status_code": response.status_code,
                    "response_text": response.text,
                }
                is_transient_subtitle_error = (
                    response.status_code in (400, 500, 503)
                    and "TOS subtitle erase error" in response.text
                    and "\"State\":\"Running\"" in response.text
                )
                self._log(
                    operation="video_subtitle_erase_poll",
                    url=url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                )
                if is_transient_subtitle_error:
                    return {
                        "success": True,
                        "status": "in_progress",
                        "task_id": task_id,
                        "raw_poll_response": raw_poll_response,
                    }
                return {
                    "success": False,
                    "status": "poll_failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": raw_poll_response,
                }

            data = response.json()
            task_status = str(data.get("status", "running")).lower()

            self._log(
                operation="video_subtitle_erase_poll",
                url=url,
                method="GET",
                request_payload={"task_id": task_id},
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms,
            )

            if not bool(data.get("success", False)):
                err = data.get("error") or {}
                return {
                    "success": False,
                    "status": "poll_failed",
                    "error": err.get("message") or "字幕擦除轮询失败",
                    "task_id": task_id,
                    "raw_poll_response": data,
                }

            if task_status in ("running", "processing", "pending", "queued"):
                return {
                    "success": True,
                    "status": "in_progress" if task_status in ("running", "processing") else "pending",
                    "task_id": task_id,
                    "raw_poll_response": data,
                }

            if task_status in ("completed", "succeeded", "success"):
                video_url = self._extract_subtitle_video_url(data)
                if not video_url:
                    return {
                        "success": False,
                        "status": "poll_failed",
                        "error": "字幕擦除结果缺少 video_url",
                        "task_id": task_id,
                        "raw_poll_response": data,
                    }
                return {
                    "success": True,
                    "status": "completed",
                    "video_url": video_url,
                    "task_id": task_id,
                    "raw_poll_response": data,
                }

            if task_status == "failed":
                err = data.get("error") or {}
                return {
                    "success": False,
                    "status": "failed",
                    "error": err.get("message") or "字幕擦除任务失败",
                    "task_id": task_id,
                    "raw_poll_response": data,
                }

            return {
                "success": False,
                "status": "poll_failed",
                "error": f"未知字幕擦除任务状态: {task_status}",
                "task_id": task_id,
                "raw_poll_response": data,
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"CreateNow subtitle erase poll error: {str(e)}"
            self._log(
                operation="video_subtitle_erase_poll",
                url=url,
                method="GET",
                request_payload={"task_id": task_id},
                error=error_msg,
                duration_ms=duration_ms,
            )
            return {
                "success": False,
                "status": "poll_failed",
                "error": error_msg,
                "task_id": task_id,
            }
