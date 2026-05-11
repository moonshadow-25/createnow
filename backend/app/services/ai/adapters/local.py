"""
本地 API 适配器

支持自定义本地部署的 API 服务，接口格式与 OpenAI 类似但有细微差异
"""

import base64
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.adapters.base import ImageAdapter, VideoAdapter
from app.services.ai.utils.image_processor import ImageProcessor
from app.core.config import settings

logger = logging.getLogger(__name__)


class LocalImageAdapter(ImageAdapter):
    """本地API图像生成适配器"""

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
        self.image_edit_model = image_edit_model

    async def generate(
        self,
        prompt: str,
        size: str,
        negative_prompt: str = "",
        **kwargs
    ) -> Dict[str, Any]:
        """生成图片 - 本地API格式（与OpenAI相同）"""
        url = f"{self.api_url}/images/generations"

        payload = {
            "model": kwargs.get("model") or self.model,
            "prompt": prompt,
            "size": size,
            "n": 1
        }

        if negative_prompt:
            payload["negative_prompt"] = negative_prompt

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self._log(
                    operation="image_generate",
                    url=url,
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
            first_item = (data.get("data") or [{}])[0]
            image_url = first_item.get("url")
            if not image_url and first_item.get("b64_json"):
                image_url = f"data:image/png;base64,{first_item['b64_json']}"
            if not image_url:
                raise ValueError("No image url or b64_json in response")
            revised_prompt = first_item.get("revised_prompt", prompt)

            self._log(
                operation="image_generate",
                url=url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "image_url": image_url,
                "revised_prompt": revised_prompt,
                "raw_response": data
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"Local API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="image_generate",
                url=url,
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
        """编辑图片 - 本地API格式

        端点：POST {api_url}/images/edits (而非 /images/generations)
        与OpenAI的区别：使用 /edits 而不是 /generations
        """
        url = f"{self.api_url}/images/edits"

        # 收集所有图片
        all_images = [image]
        if reference_images:
            all_images.extend(reference_images)

        # 自动判断使用哪种模式
        has_base64 = any(img.startswith("data:image") for img in all_images)
        has_url = any(img.startswith(("http://", "https://")) for img in all_images)

        if has_base64 and not has_url:
            use_base64_mode = True
        elif has_url and not has_base64:
            use_base64_mode = False
        elif has_base64 and has_url:
            use_base64_mode = False
        else:
            use_base64_mode = True

        # 处理图片
        processed_images = []
        for img in all_images:
            if use_base64_mode:
                if img.startswith("data:image"):
                    processed_images.append(img)
                elif img.startswith(("http://", "https://")):
                    # 下载并转base64
                    try:
                        response = await self.client.get(img)
                        response.raise_for_status()
                        image_content = response.content
                        img_b64 = base64.b64encode(image_content).decode('utf-8')
                        processed_images.append(f"data:image/png;base64,{img_b64}")
                    except Exception as e:
                        return {
                            "success": False,
                            "error": f"Failed to download image: {str(e)}",
                            "image_url": img
                        }
                else:
                    # 本地文件路径
                    b64_data, error = ImageProcessor.to_base64_sync(img)
                    if error:
                        return {"success": False, "error": error}
                    processed_images.append(b64_data)
            else:
                processed_images.append(img)

        payload = {
            "model": kwargs.get("model") or self.image_edit_model or self.model,
            "prompt": prompt,
            "image": processed_images,
            "size": size
        }

        # 创建截断版本用于日志
        payload_for_log = {
            "model": payload["model"],
            "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
            "size": size,
            "image": [img[:100] + "..." if len(img) > 100 else img for img in processed_images]
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            first_item = (data.get("data") or [{}])[0]
            image_url = first_item.get("url")
            if not image_url and first_item.get("b64_json"):
                image_url = f"data:image/png;base64,{first_item['b64_json']}"
            if not image_url:
                raise ValueError("No image url or b64_json in response")
            revised_prompt = first_item.get("revised_prompt", prompt)

            self._log(
                operation="image_edit",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "image_url": image_url,
                "revised_prompt": revised_prompt,
                "raw_response": data
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"本地API图像编辑失败: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="image_edit",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "exception_type": type(e).__name__
            }

    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }


class LocalVideoAdapter(VideoAdapter):
    """本地API视频生成适配器"""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        client,
        project_id: Optional[str] = None,
        log_callback: Optional[callable] = None,
        use_multipart: bool = True,
        **kwargs
    ):
        super().__init__(api_url, api_key, model, client, project_id, log_callback)
        self.use_multipart = use_multipart

    async def generate(
        self,
        image_url: str,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        **kwargs
    ) -> Dict[str, Any]:
        """创建视频生成任务 - 本地API格式

        端点：POST {api_url}/videos
        与OpenAI的区别：使用 image 参数而不是 input_reference
        """
        use_multipart = kwargs.get("use_multipart", self.use_multipart)
        model = kwargs.get("model") or self.model
        url = f"{self.api_url}/videos"

        if not use_multipart:
            # JSON格式
            payload = {
                "model": model,
                "prompt": prompt,
                "seconds": str(duration),
                "size": resolution,
                "image": image_url  # 使用 image 而不是 input_reference
            }

            payload_for_log = {
                "model": model,
                "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
                "seconds": str(duration),
                "size": resolution,
                "image": image_url[:100] + "..." if len(image_url) > 100 else image_url
            }

            start_time = datetime.now()

            try:
                response = await self.client.post(
                    url,
                    json=payload,
                    headers=self._get_headers()
                )
                response.raise_for_status()
                result = response.json()

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000

                self._log(
                    operation="video_generate_json",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    response_data=result,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": True,
                    "task_id": result.get("id"),
                    "status": result.get("status", "pending"),
                    "raw_create_response": result
                }

            except Exception as e:
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = f"本地API视频生成失败(JSON): {str(e)}"
                logger.error(error_msg)

                self._log(
                    operation="video_generate_json",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    error=error_msg,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": error_msg
                }

        # Multipart格式
        else:
            try:
                # 处理图片
                image_data, content_type, error = await self._process_image(image_url)
                if error:
                    return {"success": False, "error": error}

                image_filename = ImageProcessor.get_filename_for_content_type(content_type)
                logger.info(f"[视频生成] 使用图片，大小: {len(image_data)/1024:.1f}KB")

                # 构建multipart表单
                files = {
                    "image": (image_filename, image_data, content_type)  # 使用 image 字段
                }
                data = {
                    "model": model,
                    "prompt": prompt,
                    "seconds": str(duration),
                    "size": resolution
                }

                start_time = datetime.now()

                response = await self.client.post(
                    url,
                    data=data,
                    files=files,
                    headers=self._get_headers(exclude_content_type=True)
                )
                response.raise_for_status()
                result = response.json()

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000

                self._log(
                    operation="video_generate_multipart",
                    url=url,
                    method="POST",
                    request_payload={"model": data["model"], "prompt": data["prompt"], "seconds": data["seconds"], "size": data["size"], "image": "[binary]"},
                    response_data=result,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": True,
                    "task_id": result.get("id"),
                    "status": result.get("status", "pending"),
                    "raw_create_response": result
                }

            except Exception as e:
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = f"本地API视频生成失败(Multipart): {str(e)}"
                logger.error(error_msg)

                self._log(
                    operation="video_generate_multipart",
                    url=url,
                    method="POST",
                    request_payload={"model": model, "prompt": prompt, "image": "[binary]"},
                    error=error_msg,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": error_msg
                }

    async def _process_image(self, image_url: str):
        """处理图片，返回 (image_data, content_type, error)"""
        if image_url.startswith("data:image"):
            # base64格式
            header, encoded = image_url.split(",", 1)
            image_data = base64.b64decode(encoded)
            content_type = header.split(":")[1].split(";")[0]
            return image_data, content_type, None

        elif image_url.startswith(("http://", "https://")):
            # HTTP URL
            try:
                img_response = await self.client.get(image_url, timeout=30.0)
                img_response.raise_for_status()
                image_data = img_response.content
                content_type = img_response.headers.get("content-type", "image/jpeg")
                return image_data, content_type, None
            except Exception as e:
                return None, None, f"Failed to download image: {str(e)}"

        else:
            # 本地文件路径
            if not self.project_id:
                return None, None, "project_id is required for local image paths"

            project_dir = settings.PROJECTS_DIR / self.project_id
            image_path = project_dir / "images" / "files" / image_url

            if not image_path.exists():
                return None, None, f"Image file not found: {image_url}"

            with open(image_path, "rb") as f:
                image_data = f.read()

            mime_type, _ = ImageProcessor.get_mime_type(str(image_path))
            return image_data, mime_type, None

    async def poll(self, task_id: str) -> Dict[str, Any]:
        """轮询视频任务状态 - 本地API格式

        端点：GET {api_url}/video/{taskid} (而非 /video/task/{taskid})
        """
        url = f"{self.api_url}/video/{task_id}"

        start_time = datetime.now()

        try:
            response = await self.client.get(
                url,
                headers=self._get_headers(),
                timeout=30.0
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                logger.warning(f"Local API poll failed for task {task_id}: {error_msg}")

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
                    "error": error_msg,
                    "task_id": task_id
                }

            result = response.json()
            status = result.get("status", "pending")

            logger.info(f"Local API poll video task {task_id}: status={status}")

            # 提取视频URL
            detail = result.get("detail", {})
            video_url = (
                detail.get("video_url") or
                detail.get("url") or
                result.get("video_url") or
                result.get("url") or
                (result.get("data", [{}])[0].get("url") if result.get("data") else None)
            )

            self._log(
                operation="video_poll",
                url=url,
                method="GET",
                request_payload={"task_id": task_id},
                response_data=result,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            if status == "completed":
                return {
                    "success": True,
                    "status": "completed",
                    "video_url": video_url,
                    "task_id": task_id,
                    "enhanced_prompt": detail.get("enhanced_prompt", "") or result.get("enhanced_prompt", ""),
                    "raw_poll_response": result
                }
            elif status == "failed":
                error_msg = detail.get("message") or result.get("message") or "Unknown error"
                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": result
                }
            else:
                return {
                    "success": True,
                    "status": status or "pending",
                    "task_id": task_id,
                    "raw_poll_response": result
                }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"Local API poll error: {str(e)}"
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
                "error": error_msg,
                "task_id": task_id
            }

    def _get_headers(self, exclude_content_type: bool = False) -> Dict[str, str]:
        """构建请求头"""
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        if not exclude_content_type:
            headers["Content-Type"] = "application/json"
        return headers
