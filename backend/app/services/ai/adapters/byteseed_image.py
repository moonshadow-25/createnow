"""
字节Seed图像生成适配器

支持文生图和图生图，支持多图输出（1-4张）
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.adapters.base import ImageAdapter
from app.services.ai.utils.image_processor import ImageProcessor

logger = logging.getLogger(__name__)


class ByteSeedImageAdapter(ImageAdapter):
    """字节Seed图像生成适配器"""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        model: str,
        client,
        project_id: Optional[str] = None,
        log_callback: Optional[callable] = None,
        max_images: int = 1,
        watermark: bool = False,
        **kwargs
    ):
        super().__init__(api_url, api_key, model, client, project_id, log_callback)
        self.max_images = max_images
        self.watermark = watermark

    async def generate(
        self,
        prompt: str,
        size: str,
        negative_prompt: str = "",
        **kwargs
    ) -> Dict[str, Any]:
        """文生图 - 支持多图输出

        Args:
            prompt: 提示词
            size: 尺寸（如 "1920x1080"）
            negative_prompt: 负面提示词（ByteSeed不支持，忽略）
            **kwargs: 其他参数

        Returns:
            {
                "success": bool,
                "image_url": str,  # 第一张图（向后兼容）
                "images": [{"url": str, "size": str}, ...],  # 多图时存在
                "revised_prompt": str,
                "raw_response": dict
            }
        """
        url = f"{self.api_url}/images/generations"

        payload = {
            "model": kwargs.get("model") or self.model,
            "prompt": prompt,
            "size": size,  # ByteSeed使用像素格式 "1920x1080"
            "watermark": self.watermark,
            "stream": False,
            "response_format": "url"
        }

        # 如果需要多图生成
        if self.max_images > 1:
            payload["sequential_image_generation"] = "auto"
            payload["sequential_image_generation_options"] = {
                "max_images": self.max_images
            }

        # 创建截断版本用于日志
        payload_for_log = {
            "model": payload["model"],
            "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
            "size": size,
            "max_images": self.max_images,
            "watermark": self.watermark
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
                    operation="image_generate",
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

            # 提取图片列表
            images = data.get("data", [])

            if not images:
                error_msg = "No images returned from API"
                self._log(
                    operation="image_generate",
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
                    "error": error_msg,
                    "raw_response": data
                }

            logger.info(f"[ByteSeed文生图] 成功生成 {len(images)} 张图片")

            self._log(
                operation="image_generate",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            result = {
                "success": True,
                "image_url": images[0]["url"],  # 第一张图（向后兼容）
                "revised_prompt": prompt,
                "raw_response": data,
                "credits_consumed": response.headers.get("x-credits-consumed"),
            }

            # 如果有多张图，添加 images 字段
            if len(images) > 1:
                result["images"] = images

            return result

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"ByteSeed API Error: {str(e)}"
            logger.error(error_msg)

            self._log(
                operation="image_generate",
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

    async def edit(
        self,
        image: str,
        prompt: str,
        size: str,
        reference_images: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """图生图 - 支持多图输入和多图输出

        Args:
            image: 主图片（URL或base64）
            prompt: 提示词
            size: 尺寸（如 "1920x1080"）
            reference_images: 额外参考图列表
            **kwargs: 其他参数

        Returns:
            同 generate()
        """
        url = f"{self.api_url}/images/generations"

        # 收集所有图片
        all_images = [image]
        if reference_images:
            all_images.extend(reference_images)

        # 处理图片：转换为base64（如果需要）
        processed_images = []
        for img in all_images:
            if img.startswith("data:image"):
                # 已经是base64
                processed_images.append(img)
            elif img.startswith(("http://", "https://")):
                # URL格式，ByteSeed支持URL
                processed_images.append(img)
            else:
                # 本地文件路径，转换为base64
                b64_data, error = await ImageProcessor.to_base64(img, self.client)
                if error:
                    return {"success": False, "error": f"Image processing failed: {error}"}
                processed_images.append(b64_data)

        payload = {
            "model": kwargs.get("model") or self.model,
            "prompt": prompt,
            "image": processed_images,  # ByteSeed支持数组
            "size": size,
            "watermark": self.watermark,
            "stream": False,
            "response_format": "url"
        }

        # 如果需要多图生成
        if self.max_images > 1:
            payload["sequential_image_generation"] = "auto"
            payload["sequential_image_generation_options"] = {
                "max_images": self.max_images
            }

        # 创建截断版本用于日志
        payload_for_log = {
            "model": payload["model"],
            "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
            "size": size,
            "image_count": len(processed_images),
            "max_images": self.max_images,
            "watermark": self.watermark
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

            # 提取图片列表
            images = data.get("data", [])

            if not images:
                error_msg = "No images returned from API"
                self._log(
                    operation="image_edit",
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
                    "error": error_msg,
                    "raw_response": data
                }

            logger.info(f"[ByteSeed图生图] 成功生成 {len(images)} 张图片（输入 {len(processed_images)} 张参考图）")

            self._log(
                operation="image_edit",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            result = {
                "success": True,
                "image_url": images[0]["url"],  # 第一张图（向后兼容）
                "revised_prompt": prompt,
                "raw_response": data,
                "credits_consumed": response.headers.get("x-credits-consumed"),
            }

            # 如果有多张图，添加 images 字段
            if len(images) > 1:
                result["images"] = images

            return result

        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"ByteSeed API Error: {str(e)}"
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
