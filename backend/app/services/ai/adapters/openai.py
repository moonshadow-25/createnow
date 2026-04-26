"""
OpenAI 平台适配器

支持 OpenAI 及兼容 API 的图像生成和视频生成
"""

import asyncio
import base64
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.adapters.base import ImageAdapter, VideoAdapter
from app.services.ai.utils.image_processor import ImageProcessor

logger = logging.getLogger(__name__)


class OpenAIImageAdapter(ImageAdapter):
    """OpenAI 图像生成适配器"""

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
        """生成图片 - OpenAI格式"""
        url = f"{self.api_url}/images/generations"

        payload = {
            "model": kwargs.get("model") or self.model,
            "prompt": prompt,
            "size": size,
            "n": 1
        }

        # 添加负面提示词（如果API支持）
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
            error_msg = f"OpenAI API Error: {str(e)}"
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
        """编辑图片 - OpenAI格式

        支持多图参考，自动判断使用base64还是URL模式
        """
        url = f"{self.api_url}/images/generations"

        # 收集所有图片
        all_images = [image]
        if reference_images:
            all_images.extend(reference_images)

        # 自动判断使用哪种模式
        has_base64 = any(img.startswith("data:image") for img in all_images)
        has_url = any(img.startswith(("http://", "https://")) for img in all_images)

        # 判断模式
        if has_base64 and not has_url:
            use_base64_mode = True
        elif has_url and not has_base64:
            use_base64_mode = False
        elif has_base64 and has_url:
            use_base64_mode = False  # 混合时优先URL
        else:
            use_base64_mode = True  # 本地文件转base64

        # 处理图片
        processed_images = []
        for img in all_images:
            if use_base64_mode:
                b64_data, error = await ImageProcessor.to_base64(img, self.client)
                if error:
                    return {"success": False, "error": error}
                processed_images.append(b64_data)
            else:
                if img.startswith("data:image"):
                    # base64转URL不支持，报错
                    return {
                        "success": False,
                        "error": "Cannot mix base64 and URL images in URL mode"
                    }
                processed_images.append(img)

        # 构建payload
        payload = {
            "model": kwargs.get("model") or self.image_edit_model or self.model,
            "prompt": prompt,
            "size": size,
            "image": processed_images
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
                headers=self._get_headers(),
                json=payload
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text}"
                self._log(
                    operation="image_edit",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
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
            error_msg = f"OpenAI API Error: {str(e)}"
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
                "error": error_msg
            }

    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }


class OpenAIVideoAdapter(VideoAdapter):
    """OpenAI 视频生成适配器"""

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
        """创建视频生成任务"""
        use_multipart = kwargs.get("use_multipart", self.use_multipart)
        model = kwargs.get("model") or self.model

        if use_multipart:
            return await self._generate_multipart(image_url, prompt, duration, resolution, model)
        else:
            return await self._generate_json(image_url, prompt, duration, resolution, model)

    async def _generate_json(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: str
    ) -> Dict[str, Any]:
        """JSON格式生成视频"""
        url = f"{self.api_url}/video/generations"

        payload = {
            "model": model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": resolution,
            "input_reference": image_url
        }

        # 创建截断版本用于日志（避免base64过大导致卡顿）
        payload_for_log = {
            "model": model,
            "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
            "seconds": str(duration),
            "size": resolution,
            "input_reference": image_url[:100] + "..." if len(image_url) > 100 else image_url
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload
            )
            response.raise_for_status()
            data = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检测API响应中是否包含错误
            if "error" in data:
                error_msg = data.get("error", {}).get("message", "Unknown error")
                self._log(
                    operation="video_generate_json",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    error=str(data.get("error")),
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": error_msg,
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "payload": payload},
                        "error_response": data,
                        "status_code": response.status_code
                    }
                }

            task_id = data.get("id")
            if not task_id:
                self._log(
                    operation="video_generate_json",
                    url=url,
                    method="POST",
                    request_payload=payload_for_log,
                    error="API did not return a task ID",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": "API did not return a task ID",
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "payload": payload},
                        "api_response": data,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"Video task created (JSON): task_id={task_id}")

            self._log(
                operation="video_generate_json",
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
                "status": data.get("status", "pending"),
                "raw_create_response": {
                    "request": {"url": url, "method": "POST", "content_type": "application/json", "payload": payload},
                    "api_response": data
                }
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"OpenAI API Error: {str(e)}"
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
                "error": error_msg,
                "raw_create_response": {"request": {"url": url, "payload": payload}}
            }

    async def _generate_multipart(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: str
    ) -> Dict[str, Any]:
        """Multipart格式生成视频"""
        url = f"{self.api_url}/videos"

        request_params = {
            "model": model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": resolution,
        }

        try:
            # 处理图片
            image_data, content_type, error = await ImageProcessor.to_bytes(image_url, self.client)
            if error:
                return {"success": False, "error": error}

            image_filename = ImageProcessor.get_filename_for_content_type(content_type)
            request_params["image_source"] = "base64" if image_url.startswith("data:image") else "url"
            request_params["input_reference"] = image_url[:50] + "..." if len(image_url) > 50 else image_url

            logger.info(f"[视频生成] 使用图片，大小: {len(image_data)/1024:.1f}KB")

            # 构建multipart请求
            files = {"input_reference": (image_filename, image_data, content_type)}
            data = {
                "model": model,
                "prompt": prompt,
                "seconds": str(duration),
                "size": resolution
            }

            headers = {"Authorization": f"Bearer {self.api_key}"}

            logger.info(f"[视频生成] 发送multipart请求: {url}")

            start_time = datetime.now()
            response = await self.client.post(
                url,
                headers=headers,
                data=data,
                files=files
            )
            response.raise_for_status()
            result = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检测错误
            if "error" in result:
                error_msg = result.get("error", {}).get("message", "Unknown error")
                self._log(
                    operation="video_generate_multipart",
                    url=url,
                    method="POST",
                    request_payload=request_params,
                    response_data=result,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": error_msg,
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "content_type": "multipart/form-data", "params": request_params},
                        "error_response": result,
                        "status_code": response.status_code
                    }
                }

            task_id = result.get("id")
            if not task_id:
                self._log(
                    operation="video_generate_multipart",
                    url=url,
                    method="POST",
                    request_payload=request_params,
                    response_data=result,
                    error="API did not return a task ID",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": "API did not return a task ID",
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "content_type": "multipart/form-data", "params": request_params},
                        "api_response": result,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"Video task created (multipart): task_id={task_id}")

            self._log(
                operation="video_generate_multipart",
                url=url,
                method="POST",
                request_payload=request_params,
                response_data=result,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": result.get("status", "pending"),
                "raw_create_response": {
                    "request": {"url": url, "method": "POST", "content_type": "multipart/form-data", "params": request_params, "form_data": data},
                    "api_response": result
                }
            }

        except Exception as e:
            import traceback
            error_msg = f"OpenAI API Error: {str(e)}"
            logger.error(error_msg)

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {
                    "request": {"url": url, "params": request_params},
                    "traceback": traceback.format_exc()
                }
            }

    async def generate_multi_image(
        self,
        image_urls: list,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        **kwargs
    ) -> Dict[str, Any]:
        """多图模式生成视频（首尾帧）"""
        use_multipart = kwargs.get("use_multipart", self.use_multipart)
        model = kwargs.get("model") or self.model

        if use_multipart:
            return await self._generate_multipart_multi(image_urls, prompt, duration, resolution, model)
        else:
            return await self._generate_json_multi(image_urls, prompt, duration, resolution, model)

    async def _generate_json_multi(
        self,
        image_urls: list,
        prompt: str,
        duration: int,
        resolution: str,
        model: str
    ) -> Dict[str, Any]:
        """JSON格式生成视频（多图）"""
        url = f"{self.api_url}/video/generations"

        payload = {
            "model": model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": resolution,
            "input_reference": image_urls  # 数组形式
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload
            )
            response.raise_for_status()
            data = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if "error" in data:
                error_msg = data.get("error", {}).get("message", "Unknown error")
                self._log(
                    operation="video_generate_json_multi",
                    url=url,
                    method="POST",
                    request_payload={**payload, "input_reference": f"[{len(image_urls)} images]"},
                    error=str(data.get("error")),
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": error_msg,
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "payload": payload},
                        "error_response": data,
                        "status_code": response.status_code
                    }
                }

            task_id = data.get("id")
            if not task_id:
                self._log(
                    operation="video_generate_json_multi",
                    url=url,
                    method="POST",
                    request_payload={**payload, "input_reference": f"[{len(image_urls)} images]"},
                    error="API did not return a task ID",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": "API did not return a task ID",
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "payload": payload},
                        "api_response": data,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"Video task created (JSON multi-image): task_id={task_id}, images={len(image_urls)}")

            self._log(
                operation="video_generate_json_multi",
                url=url,
                method="POST",
                request_payload={**payload, "input_reference": f"[{len(image_urls)} images]"},
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": data.get("status", "pending"),
                "raw_create_response": {
                    "request": {"url": url, "method": "POST", "payload": {**payload, "input_reference": f"[{len(image_urls)} images]"}},
                    "api_response": data
                }
            }

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"OpenAI API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="video_generate_json_multi",
                url=url,
                method="POST",
                request_payload={**payload, "input_reference": f"[{len(image_urls)} images]"},
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {"request": {"url": url, "payload": payload}}
            }

    async def _generate_multipart_multi(
        self,
        image_urls: list,
        prompt: str,
        duration: int,
        resolution: str,
        model: str
    ) -> Dict[str, Any]:
        """Multipart格式生成视频（多图，首尾帧）"""
        url = f"{self.api_url}/videos"

        request_params = {
            "model": model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": resolution,
        }

        try:
            # 处理所有图片
            files = []
            image_log_entries = []
            for i, image_url in enumerate(image_urls):
                image_data, content_type, error = await ImageProcessor.to_bytes(image_url, self.client)
                if error:
                    return {"success": False, "error": f"Image {i+1} processing failed: {error}"}

                image_filename = f"image_{i}_{ImageProcessor.get_filename_for_content_type(content_type)}"
                files.append(("input_reference", (image_filename, image_data, content_type)))
                logger.info(f"[视频生成] 图片 {i+1}/{len(image_urls)}, 大小: {len(image_data)/1024:.1f}KB")
                image_log_entries.append({
                    "index": i,
                    "source": "base64" if image_url.startswith("data:image") else "url",
                    "preview": image_url[:50] + "..." if len(image_url) > 50 else image_url,
                    "size_kb": round(len(image_data) / 1024, 1)
                })

            request_params["input_references"] = image_log_entries

            # 构建multipart请求
            data = {
                "model": model,
                "prompt": prompt,
                "seconds": str(duration),
                "size": resolution
            }

            headers = {"Authorization": f"Bearer {self.api_key}"}

            logger.info(f"[视频生成] 发送multipart请求（首尾帧模式）: {url}, 图片数: {len(files)}")

            start_time = datetime.now()
            response = await self.client.post(
                url,
                headers=headers,
                data=data,
                files=files
            )
            response.raise_for_status()
            result = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检测错误
            if "error" in result:
                error_msg = result.get("error", {}).get("message", "Unknown error")
                self._log(
                    operation="video_generate_multipart_multi",
                    url=url,
                    method="POST",
                    request_payload=request_params,
                    response_data=result,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": error_msg,
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "content_type": "multipart/form-data", "params": request_params},
                        "error_response": result,
                        "status_code": response.status_code
                    }
                }

            task_id = result.get("id")
            if not task_id:
                self._log(
                    operation="video_generate_multipart_multi",
                    url=url,
                    method="POST",
                    request_payload=request_params,
                    response_data=result,
                    error="API did not return a task ID",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )
                return {
                    "success": False,
                    "error": "API did not return a task ID",
                    "raw_create_response": {
                        "request": {"url": url, "method": "POST", "content_type": "multipart/form-data", "params": request_params},
                        "api_response": result,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"Video task created (multipart multi-image): task_id={task_id}, images={len(image_urls)}")

            self._log(
                operation="video_generate_multipart_multi",
                url=url,
                method="POST",
                request_payload=request_params,
                response_data=result,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": result.get("status", "pending"),
                "raw_create_response": {
                    "request": {"url": url, "method": "POST", "content_type": "multipart/form-data", "params": request_params, "form_data": data},
                    "api_response": result
                }
            }

        except Exception as e:
            import traceback
            error_msg = f"OpenAI API Error: {str(e)}"
            logger.error(error_msg)

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {
                    "request": {"url": url, "params": request_params},
                    "traceback": traceback.format_exc()
                }
            }

    async def poll(self, task_id: str) -> Dict[str, Any]:
        """轮询视频任务状态 - 并发竞速模式"""
        logger.info(f"Polling OpenAI video task (concurrent mode): {task_id}")

        # 两个端点URL
        primary_url = f"{self.api_url}/video/task/{task_id}"

        # 构建后备端点URL
        base_url = self.api_url
        if base_url.endswith('/v1'):
            fallback_url = f"{base_url}/video/query?id={task_id}"
        else:
            fallback_url = f"{base_url}/v1/video/query?id={task_id}"

        # 创建两个并发任务
        primary_task = asyncio.create_task(self._try_poll_endpoint(primary_url, task_id, "primary"))
        fallback_task = asyncio.create_task(self._try_poll_endpoint(fallback_url, task_id, "fallback"))

        try:
            done, pending = await asyncio.wait(
                [primary_task, fallback_task],
                timeout=30.0,
                return_when=asyncio.ALL_COMPLETED
            )

            results = []
            for task in done:
                try:
                    result = await task
                    results.append(result)
                except Exception as e:
                    logger.error(f"Task failed with exception: {e}")

            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            best_result = self._select_best_result(results, task_id)
            if best_result:
                return best_result

            return {
                "success": False,
                "error": "Both endpoints failed or timed out",
                "task_id": task_id,
                "details": results
            }

        except asyncio.TimeoutError:
            primary_task.cancel()
            fallback_task.cancel()
            return {
                "success": False,
                "error": "Both endpoints timed out after 30 seconds",
                "task_id": task_id
            }

    async def _try_poll_endpoint(self, url: str, task_id: str, endpoint_type: str) -> Dict[str, Any]:
        """尝试调用指定的轮询端点"""
        import httpx

        start_time = datetime.now()

        try:
            response = await self.client.get(
                url,
                headers=self._get_headers(),
                timeout=30.0
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}"
                logger.warning(f"[{endpoint_type}] Poll failed for task {task_id}: {error_msg}")

                self._log(
                    operation=f"video_poll_{endpoint_type}",
                    url=url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "endpoint_type": endpoint_type,
                    "error": error_msg,
                    "task_id": task_id
                }

            result = response.json()
            status = result.get("status", "pending")

            logger.info(f"[{endpoint_type}] Poll video task {task_id}: status={status}")

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
                operation=f"video_poll_{endpoint_type}",
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
                    "endpoint_type": endpoint_type,
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
                    "endpoint_type": endpoint_type,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": result
                }
            else:
                return {
                    "success": True,
                    "endpoint_type": endpoint_type,
                    "status": status or "pending",
                    "task_id": task_id,
                    "raw_poll_response": result
                }

        except httpx.TimeoutException as e:
            logger.warning(f"[{endpoint_type}] Poll timeout for task {task_id}: {url}")
            return {
                "success": False,
                "endpoint_type": endpoint_type,
                "error": f"Request timeout: {str(e)}",
                "task_id": task_id
            }

        except httpx.ConnectError as e:
            logger.warning(f"[{endpoint_type}] Connection error for task {task_id}: {url}")
            return {
                "success": False,
                "endpoint_type": endpoint_type,
                "error": f"Connection error: {str(e)}",
                "task_id": task_id
            }

        except Exception as e:
            logger.error(f"[{endpoint_type}] Unexpected error polling task {task_id} at {url}: {e}")
            return {
                "success": False,
                "endpoint_type": endpoint_type,
                "error": f"Unexpected error: {str(e)}",
                "task_id": task_id
            }

    def _select_best_result(self, results: List[Dict], task_id: str) -> Optional[Dict]:
        """从多个结果中选择最佳结果"""
        if not results:
            return None

        priority = {
            "completed": 1,
            "failed": 2,
            "in_progress": 3,
            "pending": 4,
            "error": 5
        }

        successful_results = [r for r in results if r.get("success")]

        if not successful_results:
            logger.warning(f"All endpoints failed for task {task_id}, returning first error")
            return results[0] if results else None

        best = min(
            successful_results,
            key=lambda r: priority.get(r.get("status", "error"), 99)
        )

        logger.info(
            f"Selected {best.get('endpoint_type')} endpoint result "
            f"with status '{best.get('status')}' for task {task_id}"
        )

        return best

    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
