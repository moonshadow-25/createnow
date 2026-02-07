"""
阿里百炼 (DashScope) 平台适配器

支持阿里云 DashScope API 的图像生成和视频生成
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.adapters.base import ImageAdapter, VideoAdapter
from app.services.ai.utils.image_processor import ImageProcessor

logger = logging.getLogger(__name__)


class DashScopeImageAdapter(ImageAdapter):
    """阿里百炼图像生成适配器"""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        client,
        project_id: Optional[str] = None,
        log_callback: Optional[callable] = None,
        image_edit_model: Optional[str] = None,
        **kwargs
    ):
        super().__init__(api_url, api_key, model, client, project_id, log_callback)
        self.image_edit_model = image_edit_model or "wan2.6-image"

    async def generate(
        self,
        prompt: str,
        size: str,
        negative_prompt: str = "",
        **kwargs
    ) -> Dict[str, Any]:
        """生成图片 - DashScope格式

        DashScope 图像生成使用异步任务模式，这里简化为同步返回
        实际项目中可能需要轮询任务状态
        """
        # 转换 size 格式: "1024x1024" -> "1024*1024"
        dashscope_size = size.replace("x", "*")

        payload = {
            "model": kwargs.get("model") or self.model,
            "input": {
                "prompt": prompt,
            },
            "parameters": {
                "size": dashscope_size,
                "n": 1
            }
        }

        if negative_prompt:
            payload["input"]["negative_prompt"] = negative_prompt

        start_time = datetime.now()

        try:
            response = await self.client.post(
                self.api_url,
                headers=self._get_headers(),
                json=payload,
                timeout=120.0
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self._log(
                    operation="image_generate",
                    url=self.api_url,
                    method="POST",
                    request_payload=payload,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": error_msg,
                    "status_code": response.status_code
                }

            data = response.json()

            # 检查DashScope错误响应
            if data.get("code"):
                error_msg = data.get("message", "Unknown error")
                self._log(
                    operation="image_generate",
                    url=self.api_url,
                    method="POST",
                    request_payload=payload,
                    response_data=data,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": f"DashScope Error: {error_msg}",
                    "raw_response": data
                }

            # DashScope返回格式: output.results[0].url
            image_url = data.get("output", {}).get("results", [{}])[0].get("url")

            if not image_url:
                # 可能是异步任务，返回task_id
                task_id = data.get("output", {}).get("task_id")
                if task_id:
                    return {
                        "success": True,
                        "task_id": task_id,
                        "status": "pending",
                        "raw_response": data
                    }
                return {
                    "success": False,
                    "error": "No image URL in response",
                    "raw_response": data
                }

            self._log(
                operation="image_generate",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "image_url": image_url,
                "revised_prompt": prompt,
                "raw_response": data
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"DashScope API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="image_generate",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg
            }

    async def edit(
        self,
        image: str,
        prompt: str,
        size: str,
        reference_images: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """编辑图片 - DashScope格式

        支持多图参考，格式：
        {
            "model": "wan2.6-image",
            "input": {
                "messages": [{
                    "role": "user",
                    "content": [
                        {"text": "提示词"},
                        {"image": "图片1 URL或base64"}
                    ]
                }]
            },
            "parameters": {...}
        }
        """
        edit_model = kwargs.get("model") or self.image_edit_model

        # DashScope 使用像素格式 "width*height"
        # 优先使用 width/height 参数，否则从 size 转换
        width = kwargs.get("width", 1536)
        height = kwargs.get("height", 1536)
        dashscope_size = f"{width}*{height}"

        # 构建content数组
        content = [{"text": prompt}]

        # 添加主图/参考图
        images_to_add = [image]
        if reference_images:
            images_to_add.extend(reference_images)

        # 处理图片
        for img in images_to_add:
            if img.startswith("data:image"):
                content.append({"image": img})
            elif img.startswith(("http://", "https://")):
                content.append({"image": img})
            else:
                # 本地文件路径，转base64
                b64_data, error = ImageProcessor.to_base64_sync(img)
                if error:
                    return {"success": False, "error": error}
                content.append({"image": b64_data})

        payload = {
            "model": edit_model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": content
                    }
                ]
            },
            "parameters": {
                "prompt_extend": True,
                "watermark": False,
                "n": 1,
                "enable_interleave": False,
                "size": dashscope_size
            }
        }

        # 创建截断版本用于日志
        def truncate_content_for_log(content_list):
            truncated = []
            for item in content_list:
                if "text" in item:
                    text = item.get("text", "")
                    truncated.append({"text": text[:200] + "..." if len(text) > 200 else text})
                elif "image" in item:
                    img_val = item["image"]
                    if img_val.startswith("data:image"):
                        truncated.append({"image": img_val[:100] + "..."})
                    else:
                        truncated.append({"image": img_val[:100]})
                else:
                    truncated.append(item)
            return truncated

        payload_for_log = {
            "model": edit_model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": truncate_content_for_log(content)
                    }
                ]
            },
            "parameters": payload["parameters"]
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                self.api_url,
                headers=self._get_headers(),
                json=payload,
                timeout=120.0
            )

            response_text = response.text
            try:
                response_json = response.json()
            except:
                response_json = {"raw": response_text}

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response_text}"
                self._log(
                    operation="image_edit",
                    url=self.api_url,
                    method="POST",
                    request_payload=payload_for_log,
                    response_data=response_json,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": error_msg,
                    "request_url": self.api_url,
                    "request_payload": payload_for_log,
                    "response": response_json
                }

            # DashScope返回格式: output.choices[0].message.content[0].image
            image_url = response_json["output"]["choices"][0]["message"]["content"][0]["image"]

            self._log(
                operation="image_edit",
                url=self.api_url,
                method="POST",
                request_payload=payload_for_log,
                response_data=response_json,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "image_url": image_url,
                "revised_prompt": prompt,
                "response": response_json
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"DashScope API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="image_edit",
                url=self.api_url,
                method="POST",
                request_payload=payload_for_log,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "request_payload": payload_for_log
            }

    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }


class DashScopeVideoAdapter(VideoAdapter):
    """阿里百炼视频生成适配器"""

    async def generate(
        self,
        image_url: str,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        **kwargs
    ) -> Dict[str, Any]:
        """创建视频生成任务 - DashScope格式

        API: https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
        需要 X-DashScope-Async: enable 头
        """
        model = kwargs.get("model") or self.model

        # 分辨率映射
        resolution_map = {
            "1920x1080": "1080P",
            "1280x720": "720P",
            "854x480": "480P",
            "1080p": "1080P",
            "720p": "720P",
            "480p": "480P",
        }
        dashscope_resolution = resolution_map.get(resolution, resolution_map.get(resolution.lower(), "720P"))

        payload = {
            "model": model,
            "input": {
                "prompt": prompt,
                "img_url": image_url
            },
            "parameters": {
                "resolution": dashscope_resolution,
                "prompt_extend": True,
                "duration": duration
            }
        }

        request_info = {
            "url": self.api_url,
            "model": model,
            "input_resolution": resolution,
            "mapped_resolution": dashscope_resolution,
            "duration": duration,
            "payload": payload
        }
        logger.info(f"DashScope video request: {request_info}")

        start_time = datetime.now()

        try:
            # 添加异步头
            headers = self._get_headers()
            headers["X-DashScope-Async"] = "enable"

            response = await self.client.post(
                self.api_url,
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            data = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检测错误
            if "error" in data or data.get("code"):
                error_msg = data.get("message") or data.get("error", {}).get("message", "Unknown error")
                logger.error(f"DashScope video API returned error: code={data.get('code')}, message={error_msg}")

                self._log(
                    operation="video_generate",
                    url=self.api_url,
                    method="POST",
                    request_payload=payload,
                    response_data=data,
                    error=f"DashScope API Error: {error_msg}",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": f"DashScope API Error: {error_msg}",
                    "raw_create_response": {
                        "request": request_info,
                        "error_response": data,
                        "status_code": response.status_code
                    }
                }

            # DashScope响应格式: output.task_id, output.task_status
            task_id = data.get("output", {}).get("task_id")
            task_status = data.get("output", {}).get("task_status")

            if not task_id:
                logger.error(f"DashScope video API returned no task_id: {data}")

                self._log(
                    operation="video_generate",
                    url=self.api_url,
                    method="POST",
                    request_payload=payload,
                    response_data=data,
                    error="DashScope API did not return a task ID",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": "DashScope API did not return a task ID",
                    "raw_create_response": {
                        "request": request_info,
                        "api_response": data,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"DashScope video task created: task_id={task_id}, status={task_status}")

            # 统一状态为小写
            normalized_status = "pending" if task_status in ["PENDING", "RUNNING"] else task_status.lower() if task_status else "pending"

            self._log(
                operation="video_generate",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": normalized_status,
                "raw_create_response": {
                    "request": request_info,
                    "api_response": data
                }
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"DashScope API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="video_generate",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {"request": request_info}
            }

    async def poll(self, task_id: str) -> Dict[str, Any]:
        """轮询视频任务状态 - DashScope格式

        查询接口: https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
        响应状态: PENDING -> RUNNING -> SUCCEEDED / FAILED
        """
        task_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

        start_time = datetime.now()

        try:
            response = await self.client.get(
                task_url,
                headers=self._get_headers(),
                timeout=30.0
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.warning(f"DashScope poll failed for task {task_id}: {error_msg}")

                self._log(
                    operation="video_poll",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": error_msg,
                    "task_id": task_id
                }

            data = response.json()

            # DashScope状态: PENDING, RUNNING, SUCCEEDED, FAILED
            output = data.get("output", {})
            task_status = output.get("task_status", "PENDING")

            logger.info(f"DashScope poll video task {task_id}: status={task_status}")

            self._log(
                operation="video_poll",
                url=task_url,
                method="GET",
                request_payload={"task_id": task_id},
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            if task_status == "SUCCEEDED":
                video_url = output.get("video_url")
                return {
                    "success": True,
                    "status": "completed",
                    "video_url": video_url,
                    "task_id": task_id,
                    "raw_poll_response": data
                }
            elif task_status == "FAILED":
                error_msg = output.get("message") or data.get("message") or "Unknown error"
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": data
                }
            else:
                # PENDING or RUNNING
                normalized_status = "pending" if task_status == "PENDING" else "in_progress"
                return {
                    "success": True,
                    "status": normalized_status,
                    "task_id": task_id,
                    "raw_poll_response": data
                }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"DashScope poll error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="video_poll",
                url=task_url,
                method="GET",
                request_payload={"task_id": task_id},
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "task_id": task_id
            }

    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
