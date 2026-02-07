import httpx
import json
import logging
import asyncio
import base64
from typing import AsyncIterator, Optional, Dict, Any, List
from datetime import datetime
from app.core.config import settings
import re
from PIL import Image
from io import BytesIO

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


class LLMService(AIService):
    """大语言模型服务"""

    async def chat_stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4000
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式对话，返回thinking和content"""

        # 构建消息列表
        api_messages = []
        if system_prompt:
            api_messages.append({"role": "system", "content": system_prompt})
        api_messages.extend(messages)

        # 发送请求
        url = f"{self.api_url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": api_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True
        }

        try:
            async with self.client.stream(
                "POST",
                url,
                headers=self._get_headers(),
                json=payload
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    yield {
                        "type": "error",
                        "content": f"API Error: {error_text.decode()}"
                    }
                    return

                thinking_buffer = ""
                content_buffer = ""
                in_thinking = False

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break

                    try:
                        data = json.loads(data_str)
                        delta = data["choices"][0]["delta"]

                        # 检查是否有thinking内容（某些API支持）
                        if "thinking" in delta and delta["thinking"]:
                            in_thinking = True
                            thinking_buffer += delta["thinking"]
                            yield {
                                "type": "thinking",
                                "content": delta["thinking"]
                            }

                        # 检查是否有content
                        elif "content" in delta and delta["content"]:
                            # 如果之前在thinking，现在切换到content
                            if in_thinking:
                                in_thinking = False
                                yield {
                                    "type": "thinking_end",
                                    "content": thinking_buffer
                                }

                            content_buffer += delta["content"]
                            yield {
                                "type": "content",
                                "content": delta["content"]
                            }

                    except (json.JSONDecodeError, KeyError) as e:
                        continue

                # 结束
                if thinking_buffer:
                    yield {
                        "type": "thinking_end",
                        "content": thinking_buffer
                    }
                if content_buffer:
                    yield {
                        "type": "content_end",
                        "content": content_buffer
                    }

        except httpx.HTTPError as e:
            yield {
                "type": "error",
                "content": f"Network Error: {str(e)}"
            }

    async def chat(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4000
    ) -> Dict[str, Any]:
        """非流式对话"""
        # 构建消息列表
        api_messages = []
        if system_prompt:
            api_messages.append({"role": "system", "content": system_prompt})
        api_messages.extend(messages)

        url = f"{self.api_url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": api_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False
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

            # 记录成功的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="llm",
                operation="llm_chat",
                url=url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "content": data["choices"][0]["message"]["content"],
                "usage": data.get("usage", {})
            }

        except httpx.HTTPError as e:
            # 记录失败的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_detail = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_detail = e.response.text
                except:
                    pass

            self._log_interaction(
                interaction_type="llm",
                operation="llm_chat",
                url=url,
                method="POST",
                request_payload=payload,
                error=error_detail,
                status_code=e.response.status_code if hasattr(e, 'response') and e.response else None,
                duration_ms=duration_ms
            )

            return {
                "error": str(e)
            }


class ImageGenService(AIService):
    """文生图服务 - 支持OpenAI和阿里百炼"""

    def __init__(self, api_url: str, api_key: str, model: str, api_type: str = "openai", image_edit_model: Optional[str] = None, project_id: Optional[str] = None):
        super().__init__(api_url, api_key, model, project_id)
        self.api_type = api_type  # "openai" or "dashscope"
        self.image_edit_model = image_edit_model  # 阿里百炼的图像编辑模型 (wan2.6-image)

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        size_str: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """生成图片

        Args:
            prompt: 提示词
            negative_prompt: 负面提示词
            width: 像素宽度
            height: 像素高度
            size_str: 原始尺寸字符串 (如 "1x1", "16x9")，用于某些API的比例格式
            model: 覆盖模型
        """
        if self.api_type == "dashscope":
            return await self._generate_dashscope(prompt, width, height, model)
        else:
            # OpenAI格式使用 size_str (比例格式) 或回退到像素格式
            return await self._generate_openai(prompt, negative_prompt, size_str or f"{width}x{height}", model)

    async def _generate_openai(
        self,
        prompt: str,
        negative_prompt: str,
        size: str,
        model: Optional[str]
    ) -> Dict[str, Any]:
        """OpenAI格式生成图片

        Args:
            prompt: 提示词
            negative_prompt: 负面提示词
            size: 尺寸字符串 (支持比例格式如 "1x1", "16x9" 或像素格式如 "1024x1024")
            model: 覆盖模型
        """
        url = f"{self.api_url}/images/generations"

        payload = {
            "model": model or self.model,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "size": size,  # 直接使用传入的 size (比例格式如 "1x1" 或像素格式)
            "n": 1,
            "response_format": "url"
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

            # 记录成功的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="image",
                operation="image_generate_openai",
                url=url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "image_url": data["data"][0]["url"],
                "revised_prompt": data["data"][0].get("revised_prompt", prompt)
            }

        except httpx.HTTPError as e:
            # 记录失败的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            response_text = ""
            response_json = {}
            if hasattr(e, 'response') and e.response is not None:
                try:
                    response_text = e.response.text
                    response_json = e.response.json()
                except:
                    response_text = str(e.response)

            self._log_interaction(
                interaction_type="image",
                operation="image_generate_openai",
                url=url,
                method="POST",
                request_payload=payload,
                error=response_text or str(e),
                status_code=e.response.status_code if hasattr(e, 'response') and e.response else None,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": f"HTTP error: {str(e)}",
                "error_type": "httpx_error",
                "exception_type": type(e).__name__,
                "request_url": url,
                "request_payload": payload,
                "response": response_json if response_json else {"raw": response_text}
            }

    async def _generate_dashscope(
        self,
        prompt: str,
        width: int,
        height: int,
        model: Optional[str]
    ) -> Dict[str, Any]:
        """阿里百炼格式生成图片"""
        # 将 width x height 转换为 阿里格式 "宽*高"
        size = f"{width}*{height}"

        payload = {
            "model": model or self.model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"text": prompt}
                        ]
                    }
                ]
            },
            "parameters": {
                "prompt_extend": False,
                "size": size
            }
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                self.api_url,
                headers=self._get_headers(),
                json=payload
            )
            response.raise_for_status()
            data = response.json()

            # 阿里返回格式: output.choices[0].message.content[0].image
            image_url = data["output"]["choices"][0]["message"]["content"][0]["image"]

            # 记录成功的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="image",
                operation="image_generate_dashscope",
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
                "revised_prompt": prompt
            }

        except httpx.HTTPError as e:
            # 记录失败的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            response_text = ""
            response_json = None
            if hasattr(e, 'response') and e.response:
                try:
                    response_text = e.response.text
                    response_json = e.response.json()
                except:
                    response_text = str(e.response)
            else:
                response_text = str(e)

            self._log_interaction(
                interaction_type="image",
                operation="image_generate_dashscope",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                error=response_text,
                status_code=e.response.status_code if hasattr(e, 'response') and e.response else None,
                duration_ms=duration_ms
            )

            import traceback
            return {
                "success": False,
                "error": f"DashScope API Error: {response_text}",
                "request_url": self.api_url,
                "request_payload": {**payload, "model": model or self.model},
                "response": response_json,
                "traceback": traceback.format_exc()
            }

    async def edit(
        self,
        image_path: str,
        prompt: str,
        size: str = "1x1",
        width: int = 1536,
        height: int = 1536,
        model: Optional[str] = None,
        reference_images: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        图像编辑（基于参考图生成变体）

        参数:
        - image_path: 主图像路径（OpenAI用）或第一个参考图（阿里用）
        - prompt: 提示词
        - size: 尺寸字符串（比例格式如 "1x1", "16x9"，用于 OpenAI）
        - width: 像素宽度（用于 DashScope）
        - height: 像素高度（用于 DashScope）
        - model: 覆盖模型
        - reference_images: 额外的参考图URL列表（阿里百炼多图编辑用）
        """
        if self.api_type == "dashscope":
            # DashScope 需要像素格式 "width*height"
            dashscope_size = f"{width}*{height}"
            return await self._edit_dashscope(image_path, prompt, dashscope_size, model, reference_images)
        elif self.api_type == "local":
            # 本地API 使用比例格式 "1x1", "16x9"，但端点不同
            return await self._edit_local(image_path, prompt, size, model, reference_images)
        else:
            # OpenAI 使用比例格式 "1x1", "16x9"
            return await self._edit_openai(image_path, prompt, size, model, reference_images)

    async def _edit_openai(
        self,
        image_path: str,
        prompt: str,
        size: str,
        model: Optional[str],
        reference_images: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """OpenAI格式图像编辑（支持多图数组扩展）

        自动判断使用URL模式还是base64模式：
        - 如果所有图片都是 data:image/ 开头 → base64模式
        - 如果所有图片都是 http(s):// 开头 → URL模式
        - 如果混合 → URL模式（不支持混合）
        """
        import os
        import base64

        url = f"{self.api_url}/images/generations"

        # 收集所有图片
        all_images = [image_path]
        if reference_images:
            all_images.extend(reference_images)

        # 自动判断使用哪种模式
        has_base64 = any(img.startswith("data:image") for img in all_images)
        has_url = any(img.startswith(("http://", "https://")) for img in all_images)

        # 判断模式
        if has_base64 and not has_url:
            # 全部是base64 → 使用base64模式
            use_base64_mode = True
        elif has_url and not has_base64:
            # 全部是URL → 使用URL模式
            use_base64_mode = False
        elif has_base64 and has_url:
            # 混合模式 → 使用URL模式（base64需要先处理）
            # 注意：这种情况不应该发生，因为我们的API层应该保证一致性
            use_base64_mode = False
        else:
            # 都不是 → 可能是本地路径，尝试base64
            use_base64_mode = True

        if use_base64_mode:
            # 使用base64模式 - 支持数组格式（与URL模式一致）
            base64_images = []

            for img in all_images:
                if img.startswith("data:image"):
                    # 已经是base64格式，直接使用完整的data URL
                    base64_images.append(img)
                elif img.startswith(("http://", "https://")):
                    # URL，下载并转base64
                    try:
                        response = await self.client.get(img)
                        response.raise_for_status()
                        image_content = response.content
                        img_b64 = base64.b64encode(image_content).decode('utf-8')
                        # 保持完整的data URL格式
                        base64_images.append(f"data:image/png;base64,{img_b64}")
                    except Exception as e:
                        return {
                            "success": False,
                            "error": f"Failed to download image: {str(e)}",
                            "error_type": "download_failed",
                            "image_url": img,
                            "exception_type": type(e).__name__
                        }
                else:
                    # 本地文件路径
                    if os.path.exists(img):
                        with open(img, "rb") as f:
                            img_b64 = base64.b64encode(f.read()).decode('utf-8')
                            # 判断文件扩展名以确定MIME类型
                            if img.lower().endswith(('.jpg', '.jpeg')):
                                mime = 'jpeg'
                            elif img.lower().endswith('.webp'):
                                mime = 'webp'
                            else:
                                mime = 'png'
                            base64_images.append(f"data:image/{mime};base64,{img_b64}")
                    else:
                        return {
                            "success": False,
                            "error": f"Image file not found: {img}",
                            "error_type": "file_not_found",
                            "local_path": os.path.abspath(img)
                        }

            payload = {
                "model": model or self.model,
                "prompt": prompt,
                "image": base64_images,  # 数组格式，与URL模式一致
                "size": size
            }
        else:
            # 使用URL模式 - 支持多图数组
            # 验证所有图片都是有效的HTTP/HTTPS URL
            for img in all_images:
                if not (img.startswith("http://") or img.startswith("https://")):
                    return {
                        "success": False,
                        "error": f"URL mode requires all images to be HTTP/HTTPS URLs, got: {img[:100]}",
                        "error_type": "url_validation",
                        "provided_value": img[:100],
                        "request_url": url
                    }

            payload = {
                "model": model or self.model,
                "prompt": prompt,
                "image": all_images,  # 数组格式
                "size": size
            }

        # 创建用于日志的截断版payload（避免URL太长）
        payload_for_log = {
            "model": model or self.model,
            "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
            "size": size,
        }
        if "image" in payload:
            img_val = payload["image"]
            if isinstance(img_val, list):
                # 多图数组：记录每个URL的前100个字符
                payload_for_log["image"] = [img[:100] + "..." if len(img) > 100 else img for img in img_val]
            else:
                # 单图URL
                payload_for_log["image"] = img_val[:100] + "..." if len(img_val) > 100 else img_val
        if "n" in payload:
            payload_for_log["n"] = payload["n"]
        if "response_format" in payload:
            payload_for_log["response_format"] = payload["response_format"]

        # 打印实际发送的请求（用于调试）
        print(f"[IMAGE_EDIT] Sending request to {url}")
        print(f"[IMAGE_EDIT] Payload: {json.dumps(payload_for_log, ensure_ascii=False)}")

        start_time = datetime.now()
        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload,
                timeout=120.0
            )

            if response.status_code != 200:
                response_text = response.text
                try:
                    response_json = response.json()
                except:
                    response_json = {"raw": response_text}

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = f"HTTP {response.status_code}: {response_text[:500]}"

                self._log_interaction(
                    interaction_type="image",
                    operation="image_edit",
                    url=url,
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
                    "error_type": "http_error",
                    "status_code": response.status_code,
                    "request_url": url,
                    "request_payload": payload_for_log,
                    "response": response_json
                }

            # 先解析响应JSON，记录原始响应用于调试
            result = response.json()

            # 检查响应结构是否包含data字段
            if "data" not in result:
                return {
                    "success": False,
                    "error": f"API response missing 'data' field. Response keys: {list(result.keys())}",
                    "error_type": "response_format_error",
                    "request_url": url,
                    "request_payload": {
                        "model": model or self.model,
                        "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
                        "size": size,
                        "image": image_path[:100] + "..." if len(image_path) > 100 else image_path,
                    },
                    "response": result
                }

            # 检查data是否为空数组
            if not result.get("data") or len(result.get("data", [])) == 0:
                return {
                    "success": False,
                    "error": f"API returned empty data array",
                    "error_type": "response_format_error",
                    "request_url": url,
                    "request_payload": {
                        "model": model or self.model,
                        "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
                        "size": size,
                    },
                    "response": result
                }

            # 处理返回格式 - 可能是url或b64_json
            try:
                if "b64_json" in result["data"][0]:
                    b64_data = result["data"][0]["b64_json"]

                    duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                    self._log_interaction(
                        interaction_type="image",
                        operation="image_edit",
                        url=url,
                        method="POST",
                        request_payload=payload_for_log,
                        response_data=self._truncate_base64(result),
                        status_code=response.status_code,
                        duration_ms=duration_ms
                    )

                    return {
                        "success": True,
                        "image_url": f"data:image/png;base64,{b64_data}",
                        "revised_prompt": prompt,
                        "request_payload": payload_for_log  # 记录实际发送的请求
                    }
                else:
                    image_url = result["data"][0].get("url", "")
                    if not image_url:
                        return {
                            "success": False,
                            "error": f"API response missing 'url' field in data[0]. Keys: {list(result['data'][0].keys())}",
                            "error_type": "response_format_error",
                            "request_url": url,
                            "request_payload": payload_for_log,
                            "response": result
                        }

                    duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                    self._log_interaction(
                        interaction_type="image",
                        operation="image_edit",
                        url=url,
                        method="POST",
                        request_payload=payload_for_log,
                        response_data=self._truncate_base64(result),
                        status_code=response.status_code,
                        duration_ms=duration_ms
                    )

                    return {
                        "success": True,
                        "image_url": image_url,
                        "revised_prompt": result["data"][0].get("revised_prompt", prompt),
                        "request_payload": payload_for_log  # 记录实际发送的请求
                    }
            except (KeyError, IndexError, TypeError) as e:
                return {
                    "success": False,
                    "error": f"Failed to parse API response: {str(e)}",
                    "error_type": "response_parse_error",
                    "exception_type": type(e).__name__,
                    "request_url": url,
                    "request_payload": payload_for_log,
                    "response": result
                }

        except httpx.HTTPError as e:
            response_text = ""
            response_json = {}
            if hasattr(e, 'response') and e.response is not None:
                try:
                    response_text = e.response.text
                    response_json = e.response.json()
                except:
                    response_text = str(e.response)

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"HTTP error: {str(e)}"

            self._log_interaction(
                interaction_type="image",
                operation="image_edit",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                response_data=response_json if response_json else {"raw": response_text},
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "error_type": "httpx_error",
                "exception_type": type(e).__name__,
                "request_url": url,
                "response": response_json if response_json else {"raw": response_text}
            }
        except Exception as e:
            # 通用异常捕获 - 记录尽可能多的调试信息
            import traceback

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"Error: {str(e)}"

            self._log_interaction(
                interaction_type="image",
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
                "error_type": "exception",
                "exception_type": type(e).__name__,
                "request_url": url,
                "request_payload": {
                    "model": model or self.model,
                    "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
                    "size": size,
                    "image": image_path[:100] + "..." if len(image_path) > 100 else image_path,
                },
                "traceback": traceback.format_exc()
            }

    async def _edit_dashscope(
        self,
        image_path: str,
        prompt: str,
        size: str,
        model: Optional[str],
        reference_images: Optional[List[str]]
    ) -> Dict[str, Any]:
        """
        阿里百炼格式图像编辑

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
            "parameters": {
                "prompt_extend": true,
                "watermark": false,
                "n": 1,
                "size": "1280*1280"
            }
        }
        """
        import os
        import base64

        # 阿里使用图像编辑模型
        edit_model = model or self.image_edit_model or "wan2.6-image"

        # 转换 size 格式: "1024x1024" -> "1024*1024"
        dashscope_size = size.replace("x", "*")

        # 构建content数组
        content = [{"text": prompt}]

        # 添加主图/参考图
        images_to_add = [image_path]
        if reference_images:
            images_to_add.extend(reference_images)

        # 自动判断：根据图片格式决定处理方式
        # DashScope支持直接传入 data:image/xxx;base64,xxx 格式
        for img in images_to_add:
            if img.startswith("data:image"):
                # 已经是base64格式，直接使用
                content.append({"image": img})
            elif img.startswith(("http://", "https://")):
                # HTTP URL，可以直接使用或下载转base64
                # DashScope支持直接传URL，为了保持一致性，这里也可以转base64
                # 先尝试直接使用URL
                content.append({"image": img})
            else:
                # 本地文件路径，读取并转base64
                if os.path.exists(img):
                    with open(img, "rb") as f:
                        img_b64 = base64.b64encode(f.read()).decode('utf-8')
                        # 判断文件类型
                        if img.lower().endswith(('.jpg', '.jpeg')):
                            mime = 'jpeg'
                        elif img.lower().endswith('.png'):
                            mime = 'png'
                        elif img.lower().endswith('.webp'):
                            mime = 'webp'
                        else:
                            mime = 'png'
                        content.append({"image": f"data:image/{mime};base64,{img_b64}"})
                else:
                    return {
                        "success": False,
                        "error": f"Image file not found: {img}",
                        "error_type": "file_not_found",
                        "local_path": os.path.abspath(img)
                    }

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

        # 创建截断版本的payload用于日志（避免base64太大）
        def truncate_content_for_log(content_list):
            truncated = []
            for item in content_list:
                if "text" in item:
                    truncated.append({"text": item["text"][:200] + "..." if len(item.get("text", "")) > 200 else item["text"]})
                elif "image" in item:
                    img_val = item["image"]
                    if img_val.startswith("data:image"):
                        # 截断base64
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
            "parameters": {
                "prompt_extend": True,
                "watermark": False,
                "n": 1,
                "enable_interleave": False,
                "size": dashscope_size
            }
        }

        start_time = datetime.now()
        try:
            response = await self.client.post(
                self.api_url,
                headers=self._get_headers(),
                json=payload,
                timeout=120.0
            )

            # 解析响应
            response_text = response.text
            try:
                response_json = response.json()
            except:
                response_json = {"raw": response_text}

            if response.status_code != 200:
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = f"HTTP {response.status_code}: {response_text}"

                self._log_interaction(
                    interaction_type="image",
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

            # 阿里返回格式: output.choices[0].message.content[0].image
            image_url = response_json["output"]["choices"][0]["message"]["content"][0]["image"]

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="image",
                operation="image_edit",
                url=self.api_url,
                method="POST",
                request_payload=payload_for_log,
                response_data=self._truncate_base64(response_json),
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "image_url": image_url,
                "revised_prompt": prompt,
                "response": response_json
            }

        except httpx.HTTPError as e:
            response_text = e.response.text if hasattr(e, 'response') and e.response else str(e)
            response_json = {}
            if hasattr(e, 'response') and e.response:
                try:
                    response_json = e.response.json()
                except:
                    pass

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"DashScope API Error: {response_text}"

            self._log_interaction(
                interaction_type="image",
                operation="image_edit",
                url=self.api_url,
                method="POST",
                request_payload=payload_for_log,
                response_data=response_json,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "request_url": self.api_url,
                "request_payload": payload_for_log,
                "response": response_json
            }
        except Exception as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"Error: {str(e)}"

            self._log_interaction(
                interaction_type="image",
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
                "request_payload": payload_for_log,
                "response": {}
            }

    async def _edit_local(
        self,
        image_path: str,
        prompt: str,
        size: str,
        model: Optional[str],
        reference_images: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        本地API图像编辑

        端点：POST {api_url}/images/edits (而非 /images/generations)
        与OpenAI的区别：使用 /edits 而不是 /generations
        请求格式与OpenAI相同，支持多图数组
        """
        import os
        import base64

        # 使用 /images/edits 端点（本地API特有）
        url = f"{self.api_url}/images/edits"

        # 收集所有图片
        all_images = [image_path]
        if reference_images:
            all_images.extend(reference_images)

        # 自动判断使用哪种模式（与OpenAI逻辑相同）
        has_base64 = any(img.startswith("data:image") for img in all_images)
        has_url = any(img.startswith(("http://", "https://")) for img in all_images)

        # 判断模式
        if has_base64 and not has_url:
            use_base64_mode = True
        elif has_url and not has_base64:
            use_base64_mode = False
        elif has_base64 and has_url:
            use_base64_mode = False
        else:
            use_base64_mode = True

        if use_base64_mode:
            # 使用base64模式
            base64_images = []

            for img in all_images:
                if img.startswith("data:image"):
                    base64_images.append(img)
                elif img.startswith(("http://", "https://")):
                    try:
                        response = await self.client.get(img)
                        response.raise_for_status()
                        image_content = response.content
                        img_b64 = base64.b64encode(image_content).decode('utf-8')
                        base64_images.append(f"data:image/png;base64,{img_b64}")
                    except Exception as e:
                        return {
                            "success": False,
                            "error": f"Failed to download image: {str(e)}",
                            "error_type": "download_failed",
                            "image_url": img
                        }
                else:
                    # 本地文件路径
                    if os.path.exists(img):
                        with open(img, "rb") as f:
                            img_b64 = base64.b64encode(f.read()).decode('utf-8')
                            if img.lower().endswith(('.jpg', '.jpeg')):
                                mime = 'jpeg'
                            elif img.lower().endswith('.webp'):
                                mime = 'webp'
                            else:
                                mime = 'png'
                            base64_images.append(f"data:image/{mime};base64,{img_b64}")
                    else:
                        return {
                            "success": False,
                            "error": f"Image file not found: {img}",
                            "error_type": "file_not_found"
                        }

            payload = {
                "model": model or self.image_edit_model or self.model,
                "prompt": prompt,
                "image": base64_images,
                "size": size
            }
        else:
            # 使用URL模式
            payload = {
                "model": model or self.image_edit_model or self.model,
                "prompt": prompt,
                "image": all_images,
                "size": size
            }

        # 创建截断版本用于日志
        payload_for_log = {
            "model": payload["model"],
            "prompt": prompt[:200] + "..." if len(prompt) > 200 else prompt,
            "size": size,
            "image": [
                img[:100] + "..." if len(img) > 100 else img
                for img in (payload["image"] if isinstance(payload["image"], list) else [payload["image"]])
            ]
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                json=payload,
                headers=self._get_headers(),
                timeout=120.0
            )
            response.raise_for_status()
            data = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 解析响应（与OpenAI格式相同）
            image_url = data["data"][0]["url"]
            revised_prompt = data["data"][0].get("revised_prompt", prompt)

            self._log_interaction(
                interaction_type="image",
                operation="image_edit_local",
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

            self._log_interaction(
                interaction_type="image",
                operation="image_edit_local",
                url=url,
                method="POST",
                request_payload=payload_for_log,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "error_type": "exception",
                "exception_type": type(e).__name__
            }


class VideoGenService(AIService):
    """图生视频服务 - 支持OpenAI和阿里百炼"""

    def __init__(self, api_url: str, api_key: str, model: str, api_type: str = "openai", use_multipart: bool = True, project_id: Optional[str] = None):
        super().__init__(api_url, api_key, model, project_id)
        self.api_type = api_type  # "openai" or "dashscope"
        self.use_multipart = use_multipart  # 默认使用multipart/form-data文件上传

    @staticmethod
    def scale_image_to_1080p(image_url: str) -> str:
        """
        将图片缩放到1080p（短边=1080）

        Args:
            image_url: 图片URL（支持 http(s):// 或 data:image/...;base64,... 格式）

        Returns:
            缩放后的base64格式图片 (data:image/jpeg;base64,...)
        """
        try:
            # 1. 获取图片数据
            if image_url.startswith("data:image"):
                # 已经是base64格式，提取数据部分
                header, encoded = image_url.split(",", 1)
                image_data = base64.b64decode(encoded)
            elif image_url.startswith(("http://", "https://")):
                # HTTP URL，需要下载
                import httpx
                response = httpx.get(image_url, timeout=30.0)
                response.raise_for_status()
                image_data = response.content
            else:
                logger.warning(f"Unsupported image URL format: {image_url[:100]}")
                return image_url

            # 2. 打开图片
            img = Image.open(BytesIO(image_data))
            original_width, original_height = img.size

            # 3. 判断是否需要缩放（短边 > 1080）
            short_side = min(original_width, original_height)
            if short_side <= 1080:
                logger.info(f"[图片缩放] 短边={short_side}，无需缩放")
                return image_url

            # 4. 计算缩放比例（短边缩放到1080）
            scale_ratio = 1080 / short_side
            new_width = int(original_width * scale_ratio)
            new_height = int(original_height * scale_ratio)

            logger.info(f"[图片缩放] 原始尺寸: {original_width}x{original_height}, 缩放后: {new_width}x{new_height}, 比例: {scale_ratio:.3f}")

            # 5. 缩放图片（使用高质量重采样）
            img_resized = img.resize((new_width, new_height), Image.LANCZOS)

            # 6. 转换为JPEG并压缩（quality=85，高质量）
            buffer = BytesIO()
            # 如果是RGBA模式，转换为RGB
            if img_resized.mode == 'RGBA':
                img_resized = img_resized.convert('RGB')
            img_resized.save(buffer, format='JPEG', quality=85, optimize=True)

            # 7. 转换为base64
            img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            result = f"data:image/jpeg;base64,{img_base64}"

            # 8. 记录压缩效果
            original_size = len(image_data)
            compressed_size = len(buffer.getvalue())
            compression_ratio = (1 - compressed_size / original_size) * 100
            logger.info(f"[图片缩放] 原始大小: {original_size/1024:.1f}KB, 压缩后: {compressed_size/1024:.1f}KB, 压缩率: {compression_ratio:.1f}%")

            return result

        except Exception as e:
            logger.error(f"[图片缩放] 失败: {e}")
            # 失败时返回原图
            return image_url

    async def generate(
        self,
        image_url: str,
        prompt: str,
        duration: int = 6,
        resolution: str = "1920x1080",
        model: Optional[str] = None,
        use_multipart: Optional[bool] = None
    ) -> Dict[str, Any]:
        """生成视频

        Args:
            use_multipart: 是否使用multipart/form-data格式上传文件。
                          None时使用实例配置的默认值（self.use_multipart）
        """
        # 如果没有传递参数，使用实例配置
        if use_multipart is None:
            use_multipart = self.use_multipart

        if self.api_type == "dashscope":
            return await self._generate_dashscope(image_url, prompt, duration, resolution, model)
        elif self.api_type == "local":
            # 本地API 使用 image 参数而不是 input_reference
            return await self._generate_local(image_url, prompt, duration, resolution, model, use_multipart)
        else:
            return await self._generate_openai(image_url, prompt, duration, resolution, model, use_multipart)

    async def _generate_openai(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: Optional[str],
        use_multipart: bool = True
    ) -> Dict[str, Any]:
        """OpenAI格式生成视频（支持JSON和multipart/form-data两种格式）"""

        if use_multipart:
            return await self._generate_openai_multipart(image_url, prompt, duration, resolution, model)
        else:
            return await self._generate_openai_json(image_url, prompt, duration, resolution, model)

    async def _generate_openai_json(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: Optional[str]
    ) -> Dict[str, Any]:
        """OpenAI格式生成视频（JSON格式）- 原有实现"""
        url = f"{self.api_url}/video/generations"

        payload = {
            "model": model or self.model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": resolution,
            "input_reference": image_url
        }

        start_time = datetime.now()

        try:
            response = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload,
                timeout=120.0
            )
            response.raise_for_status()
            data = response.json()

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # 检测API响应中是否包含错误（即使HTTP状态码是200）
            if "error" in data:
                logger.error(f"OpenAI video API returned error: {data.get('error')}")

                # 记录失败的API调用
                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate_openai_json",
                    url=url,
                    method="POST",
                    request_payload=payload,
                    error=str(data.get("error")),
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": data.get("error", {}).get("message", "Unknown error"),
                    "raw_create_response": {
                        "request": {
                            "url": url,
                            "method": "POST",
                            "content_type": "application/json",
                            "payload": payload
                        },
                        "error_response": data,
                        "status_code": response.status_code
                    }
                }

            # 正常成功的情况
            raw_create_response = data.copy()

            # 获取 task_id（不阻塞，直接返回）
            task_id = data.get("id")
            task_status = data.get("status")

            # 如果没有task_id也应该视为错误
            if not task_id:
                logger.error(f"OpenAI video API returned no task_id: {data}")

                # 记录失败的API调用
                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate_openai_json",
                    url=url,
                    method="POST",
                    request_payload=payload,
                    error="API did not return a task ID",
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": "API did not return a task ID",
                    "raw_create_response": {
                        "request": {
                            "url": url,
                            "method": "POST",
                            "content_type": "application/json",
                            "payload": payload
                        },
                        "api_response": data,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"Video task created (JSON): task_id={task_id}, status={task_status}")

            # 记录成功的API调用
            self._log_interaction(
                interaction_type="video",
                operation="video_generate_openai_json",
                url=url,
                method="POST",
                request_payload=payload,
                response_data=data,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": task_status or "pending",
                "raw_create_response": {
                    "request": {
                        "url": url,
                        "method": "POST",
                        "content_type": "application/json",
                        "payload": payload
                    },
                    "api_response": raw_create_response
                }
            }

        except httpx.HTTPError as e:
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            response_text = ""
            response_json = None
            status_code = None

            if hasattr(e, 'response') and e.response is not None:
                status_code = e.response.status_code
                try:
                    response_text = e.response.text
                    response_json = e.response.json()
                except:
                    response_text = str(e.response.content) if hasattr(e.response, 'content') else str(e.response)

            logger.error(f"OpenAI video API error (JSON): {str(e)}, status: {status_code}, response: {response_text}")

            # 记录失败的API调用
            self._log_interaction(
                interaction_type="video",
                operation="video_generate_openai_json",
                url=url,
                method="POST",
                request_payload=payload,
                error=response_text or str(e),
                status_code=status_code,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": f"OpenAI API Error: {str(e)}",
                "raw_create_response": {
                    "request": {
                        "url": url,
                        "method": "POST",
                        "content_type": "application/json",
                        "payload": payload
                    },
                    "error_response": response_json or response_text,
                    "status_code": status_code
                }
            }

    async def _generate_openai_multipart(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: Optional[str]
    ) -> Dict[str, Any]:
        """OpenAI格式生成视频（multipart/form-data格式）"""
        url = f"{self.api_url}/videos"

        # 准备请求参数（用于日志记录）
        request_params = {
            "model": model or self.model,
            "prompt": prompt,
            "seconds": str(duration),
            "size": resolution,
        }

        try:
            # 处理图片：将base64或URL转换为二进制数据
            image_data = None
            image_filename = "image.jpg"
            content_type = "image/jpeg"

            if image_url.startswith("data:image"):
                # base64格式：提取数据部分
                header, encoded = image_url.split(",", 1)
                image_data = base64.b64decode(encoded)

                # 从header中提取MIME类型
                content_type = header.split(":")[1].split(";")[0]
                if "image/png" in header:
                    image_filename = "image.png"
                elif "image/jpeg" in header or "image/jpg" in header:
                    image_filename = "image.jpg"
                elif "image/webp" in header:
                    image_filename = "image.webp"

                request_params["image_source"] = "base64"
                request_params["input_reference"] = image_url[:50] + "..."
                logger.info(f"[视频生成] 使用base64图片，大小: {len(image_data)/1024:.1f}KB")

            elif image_url.startswith(("http://", "https://")):
                # HTTP URL：下载图片
                img_response = await self.client.get(image_url, timeout=30.0)
                img_response.raise_for_status()
                image_data = img_response.content

                # 从Content-Type判断文件类型
                content_type = img_response.headers.get("content-type", "image/jpeg")
                if "png" in content_type:
                    image_filename = "image.png"
                elif "webp" in content_type:
                    image_filename = "image.webp"

                request_params["image_source"] = "url"
                request_params["input_reference"] = image_url[:100] + "..." if len(image_url) > 100 else image_url
                logger.info(f"[视频生成] 从URL下载图片，大小: {len(image_data)/1024:.1f}KB")
            else:
                return {
                    "success": False,
                    "error": f"Unsupported image format: {image_url[:100]}",
                    "raw_create_response": {
                        "request": {"url": url, "params": request_params},
                        "error": "Invalid image_url format"
                    }
                }

            # 构建multipart/form-data请求
            # 正确的格式：直接传bytes，httpx会自动处理
            files = {
                "input_reference": (image_filename, image_data, content_type)
            }

            data = {
                "model": model or self.model,
                "prompt": prompt,
                "seconds": str(duration),
                "size": resolution
            }

            # 发送multipart/form-data请求（不设置Content-Type，让httpx自动处理）
            headers = {
                "Authorization": f"Bearer {self.api_key}"
                # 不设置Content-Type，httpx会自动添加multipart/form-data和boundary
            }

            logger.info(f"[视频生成] 发送multipart/form-data请求: {url}")
            logger.info(f"[视频生成] 参数: model={data['model']}, prompt={data['prompt'][:50]}..., seconds={data['seconds']}, size={data['size']}")

            start_time = datetime.now()
            response = await self.client.post(
                url,
                headers=headers,
                data=data,
                files=files,
                timeout=120.0
            )
            response.raise_for_status()
            result = response.json()

            # 检测API响应中是否包含错误（即使HTTP状态码是200）
            if "error" in result:
                logger.error(f"OpenAI video API returned error: {result.get('error')}")

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = result.get("error", {}).get("message", "Unknown error")

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate",
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
                        "request": {
                            "url": url,
                            "method": "POST",
                            "content_type": "multipart/form-data",
                            "params": request_params,
                            "form_data": data
                        },
                        "error_response": result,
                        "status_code": response.status_code
                    }
                }

            # 正常成功的情况
            raw_create_response = result.copy()

            # 获取 task_id（不阻塞，直接返回）
            task_id = result.get("id")
            task_status = result.get("status")

            # 如果没有task_id也应该视为错误
            if not task_id:
                logger.error(f"OpenAI video API returned no task_id: {result}")

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = "API did not return a task ID"

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate",
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
                        "request": {
                            "url": url,
                            "method": "POST",
                            "content_type": "multipart/form-data",
                            "params": request_params,
                            "form_data": data
                        },
                        "api_response": result,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"Video task created (multipart): task_id={task_id}, status={task_status}")

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="video",
                operation="video_generate",
                url=url,
                method="POST",
                request_payload=request_params,
                response_data=raw_create_response,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": task_status or "pending",
                "raw_create_response": {
                    "request": {
                        "url": url,
                        "method": "POST",
                        "content_type": "multipart/form-data",
                        "params": request_params,
                        "form_data": data
                    },
                    "api_response": raw_create_response
                }
            }

        except httpx.HTTPError as e:
            response_text = ""
            response_json = None
            status_code = None

            if hasattr(e, 'response') and e.response is not None:
                status_code = e.response.status_code
                try:
                    response_text = e.response.text
                    response_json = e.response.json()
                except:
                    response_text = str(e.response.content) if hasattr(e.response, 'content') else str(e.response)

            logger.error(f"OpenAI video API error (multipart): {str(e)}, status: {status_code}, response: {response_text}")

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"OpenAI API Error: {str(e)}"

            self._log_interaction(
                interaction_type="video",
                operation="video_generate",
                url=url,
                method="POST",
                request_payload=request_params,
                response_data=response_json or {"raw": response_text},
                error=error_msg,
                status_code=status_code,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {
                    "request": {
                        "url": url,
                        "method": "POST",
                        "content_type": "multipart/form-data",
                        "params": request_params
                    },
                    "error_response": response_json or response_text,
                    "status_code": status_code
                }
            }
        except Exception as e:
            logger.error(f"Unexpected error in video generation (multipart): {str(e)}")
            import traceback

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"Unexpected error: {str(e)}"

            self._log_interaction(
                interaction_type="video",
                operation="video_generate",
                url=url,
                method="POST",
                request_payload=request_params,
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {
                    "request": {
                        "url": url,
                        "method": "POST",
                        "content_type": "multipart/form-data",
                        "params": request_params
                    },
                    "traceback": traceback.format_exc()
                }
            }

    async def _generate_dashscope(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: Optional[str]
    ) -> Dict[str, Any]:
        """阿里百炼格式生成视频（异步任务）

        API: https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
        需要 X-DashScope-Async: enable 头
        """
        # 分辨率映射: "1920x1080" -> "1080P", "1280x720" -> "720P", "854x480" -> "480P"
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
            "model": model or self.model,
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

        # 记录请求信息用于调试
        request_info = {
            "url": self.api_url,
            "model": model or self.model,
            "input_resolution": resolution,
            "mapped_resolution": dashscope_resolution,
            "duration": duration,
            "payload": payload
        }
        logger.info(f"DashScope video request: {request_info}")

        start_time = datetime.now()
        try:
            # 添加异步头
            headers = self._get_headers({"X-DashScope-Async": "enable"})

            response = await self.client.post(
                self.api_url,
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            data = response.json()

            # 检测API响应中是否包含错误（DashScope可能在HTTP 200时返回错误）
            if "error" in data or data.get("code"):
                error_msg = data.get("message") or data.get("error", {}).get("message", "Unknown error")
                logger.error(f"DashScope video API returned error: code={data.get('code')}, message={error_msg}")

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                full_error_msg = f"DashScope API Error: {error_msg}"

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate",
                    url=self.api_url,
                    method="POST",
                    request_payload=payload,
                    response_data=data,
                    error=full_error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": full_error_msg,
                    "raw_create_response": {
                        "request": request_info,
                        "error_response": data,
                        "status_code": response.status_code
                    }
                }

            # 保存原始响应
            raw_create_response = data.copy()

            # 阿里响应格式: output.task_id, output.task_status
            task_id = data.get("output", {}).get("task_id")
            task_status = data.get("output", {}).get("task_status")  # PENDING

            # 如果没有task_id也应该视为错误
            if not task_id:
                logger.error(f"DashScope video API returned no task_id: {data}")

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = "DashScope API did not return a task ID"

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate",
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
                    "error": error_msg,
                    "raw_create_response": {
                        "request": request_info,
                        "api_response": data,
                        "status_code": response.status_code
                    }
                }

            logger.info(f"DashScope video task created: task_id={task_id}, status={task_status}")

            # 统一状态为小写
            normalized_status = "pending" if task_status in ["PENDING", "RUNNING"] else task_status.lower() if task_status else "pending"

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="video",
                operation="video_generate",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                response_data=raw_create_response,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            return {
                "success": True,
                "task_id": task_id,
                "status": normalized_status,
                "raw_create_response": {
                    "request": request_info,
                    "api_response": raw_create_response
                }
            }

        except httpx.HTTPError as e:
            response_text = ""
            response_json = None
            if hasattr(e, 'response') and e.response is not None:
                try:
                    response_text = e.response.text
                    response_json = e.response.json()
                except:
                    response_text = str(e.response)

            logger.error(f"DashScope video API error: {str(e)}, response: {response_text}")

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = f"DashScope API Error: {str(e)}"

            self._log_interaction(
                interaction_type="video",
                operation="video_generate",
                url=self.api_url,
                method="POST",
                request_payload=payload,
                response_data=response_json or {"raw": response_text},
                error=error_msg,
                duration_ms=duration_ms
            )

            return {
                "success": False,
                "error": error_msg,
                "raw_create_response": {
                    "request": request_info,
                    "error_response": response_json or response_text
                }
            }

    async def _generate_local(
        self,
        image_url: str,
        prompt: str,
        duration: int,
        resolution: str,
        model: Optional[str],
        use_multipart: bool = True
    ) -> Dict[str, Any]:
        """
        本地API视频生成

        端点：POST {api_url}/videos
        与OpenAI的区别：使用 image 参数而不是 input_reference
        支持JSON和multipart两种格式
        """
        url = f"{self.api_url}/videos"

        # JSON格式
        if not use_multipart:
            payload = {
                "model": model or self.model,
                "prompt": prompt,
                "seconds": str(duration),
                "size": resolution,
                "image": image_url  # ✅ 使用 image 而不是 input_reference
            }

            start_time = datetime.now()

            try:
                response = await self.client.post(
                    url,
                    json=payload,
                    headers=self._get_headers(),
                    timeout=120.0
                )
                response.raise_for_status()
                result = response.json()

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate_local_json",
                    url=url,
                    method="POST",
                    request_payload=payload,
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

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate_local_json",
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

        # Multipart格式
        else:
            # 处理图片：将base64或URL转换为二进制数据
            image_data = None
            image_filename = "image.jpg"
            content_type = "image/jpeg"

            try:
                if image_url.startswith("data:image"):
                    # base64格式：提取数据部分
                    header, encoded = image_url.split(",", 1)
                    image_data = base64.b64decode(encoded)

                    # 从header中提取MIME类型
                    content_type = header.split(":")[1].split(";")[0]
                    if "image/png" in header:
                        image_filename = "image.png"
                    elif "image/jpeg" in header or "image/jpg" in header:
                        image_filename = "image.jpg"
                    elif "image/webp" in header:
                        image_filename = "image.webp"

                    logger.info(f"[视频生成] 使用base64图片，大小: {len(image_data)/1024:.1f}KB")

                elif image_url.startswith(("http://", "https://")):
                    # HTTP URL：下载图片
                    img_response = await self.client.get(image_url, timeout=30.0)
                    img_response.raise_for_status()
                    image_data = img_response.content

                    # 从Content-Type判断文件类型
                    content_type = img_response.headers.get("content-type", "image/jpeg")
                    if "png" in content_type:
                        image_filename = "image.png"
                    elif "webp" in content_type:
                        image_filename = "image.webp"

                    logger.info(f"[视频生成] 从URL下载图片，大小: {len(image_data)/1024:.1f}KB")
                else:
                    # 本地文件路径
                    if not self.project_id:
                        raise ValueError("project_id is required for local image paths")

                    project_dir = settings.PROJECTS_DIR / self.project_id
                    image_path = project_dir / "images" / "files" / image_url

                    if not image_path.exists():
                        raise FileNotFoundError(f"Image file not found: {image_url}")

                    with open(image_path, "rb") as f:
                        image_data = f.read()

                    # 从文件扩展名判断类型
                    if image_path.suffix.lower() == ".png":
                        image_filename = "image.png"
                        content_type = "image/png"
                    elif image_path.suffix.lower() == ".webp":
                        image_filename = "image.webp"
                        content_type = "image/webp"

                    logger.info(f"[视频生成] 使用本地图片，大小: {len(image_data)/1024:.1f}KB")

            except Exception as e:
                return {
                    "success": False,
                    "error": f"Failed to process image: {str(e)}"
                }

            # 构建multipart表单
            files = {
                "image": (image_filename, image_data, content_type)  # ✅ 使用 image 字段
            }
            data = {
                "model": model or self.model,
                "prompt": prompt,
                "seconds": str(duration),
                "size": resolution
            }

            start_time = datetime.now()

            try:
                response = await self.client.post(
                    url,
                    data=data,
                    files=files,
                    headers=self._get_headers(exclude_content_type=True),
                    timeout=120.0
                )
                response.raise_for_status()
                result = response.json()

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate_local_multipart",
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

                self._log_interaction(
                    interaction_type="video",
                    operation="video_generate_local_multipart",
                    url=url,
                    method="POST",
                    request_payload={"model": data["model"], "prompt": data["prompt"], "image": "[binary]"},
                    error=error_msg,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "error": error_msg
                }

    async def poll_video_task(self, task_id: str) -> Dict[str, Any]:
        """单次轮询视频生成任务状态（非阻塞）

        根据 api_type 选择不同的轮询实现
        返回当前状态和完整响应
        """
        logger.info(f"poll_video_task called: task_id={task_id}, api_type={self.api_type}")

        if self.api_type == "dashscope":
            return await self._poll_video_task_dashscope(task_id)
        elif self.api_type == "local":
            # 本地API 使用 /video/{taskid} 而不是 /video/task/{taskid}
            return await self._poll_video_task_local(task_id)
        else:
            return await self._poll_video_task_openai(task_id)

    async def _poll_video_task_openai(self, task_id: str) -> Dict[str, Any]:
        """OpenAI格式单次轮询视频任务（并发竞速模式）

        同时向两个端点发送请求，智能选择最佳响应：
        1. 主端点: {api_url}/video/task/{taskId}
        2. 后备端点: {api_url}/v1/video/query?id={taskId}

        返回当前状态和完整响应
        """
        logger.info(f"Polling OpenAI video task (concurrent mode): {task_id}")

        # 两个端点URL
        primary_url = f"{self.api_url}/video/task/{task_id}"

        # 构建后备端点URL，避免重复的/v1
        base_url = self.api_url
        if base_url.endswith('/v1'):
            fallback_url = f"{base_url}/video/query?id={task_id}"
        else:
            fallback_url = f"{base_url}/v1/video/query?id={task_id}"

        # 创建两个并发任务
        primary_task = asyncio.create_task(
            self._try_poll_endpoint(primary_url, task_id, "primary")
        )
        fallback_task = asyncio.create_task(
            self._try_poll_endpoint(fallback_url, task_id, "fallback")
        )

        try:
            # 等待两个任务完成，总超时30秒
            done, pending = await asyncio.wait(
                [primary_task, fallback_task],
                timeout=30.0,
                return_when=asyncio.ALL_COMPLETED
            )

            # 收集所有结果
            results = []
            for task in done:
                try:
                    result = await task
                    results.append(result)
                except Exception as e:
                    logger.error(f"Task failed with exception: {e}")

            # 处理超时的任务
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            # 智能选择最佳结果
            best_result = self._select_best_result(results, task_id)

            if best_result:
                return best_result

            # 两个都失败
            logger.error(f"Both endpoints failed for task {task_id}")
            return {
                "success": False,
                "error": "Both endpoints failed or timed out",
                "task_id": task_id,
                "details": results
            }

        except asyncio.TimeoutError:
            # 30秒内两个请求都没有返回
            primary_task.cancel()
            fallback_task.cancel()

            logger.error(f"Both endpoints timed out for task {task_id} after 30 seconds")

            return {
                "success": False,
                "error": "Both endpoints timed out after 30 seconds",
                "task_id": task_id
            }

    async def _try_poll_endpoint(
        self,
        url: str,
        task_id: str,
        endpoint_type: str
    ) -> Dict[str, Any]:
        """
        尝试调用指定的轮询端点（支持并发调用）

        Args:
            url: 轮询端点URL
            task_id: 任务ID
            endpoint_type: 端点类型（"primary" 或 "fallback"，用于日志）

        Returns:
            {
                "success": bool,           # 是否成功调用端点
                "endpoint_type": str,      # 端点类型
                "status": str,             # 视频状态
                "video_url": str,          # 视频URL（如果完成）
                "error": str,              # 错误信息（如果失败）
                "raw_poll_response": dict  # 原始响应
            }
        """
        start_time = datetime.now()

        try:
            response = await self.client.get(
                url,
                headers=self._get_headers(),
                timeout=30.0
            )

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000

            # HTTP错误判断
            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}"
                logger.warning(f"[{endpoint_type}] Poll failed for task {task_id}: {error_msg}")

                self._log_interaction(
                    interaction_type="video",
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

            # 解析响应
            result = response.json()
            status = result.get("status", "pending")

            logger.info(f"[{endpoint_type}] Poll video task {task_id}: status={status}")

            # 提取视频URL（多层级回退）
            detail = result.get("detail", {})
            video_url = (
                detail.get("video_url") or
                detail.get("url") or
                result.get("video_url") or
                result.get("url") or
                (result.get("data", [{}])[0].get("url") if result.get("data") else None)
            )

            # 记录日志
            self._log_interaction(
                interaction_type="video",
                operation=f"video_poll_{endpoint_type}",
                url=url,
                method="GET",
                request_payload={"task_id": task_id},
                response_data=result,
                status_code=response.status_code,
                duration_ms=duration_ms
            )

            # 构建返回结果
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
                # pending 或 in_progress 状态
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
        """
        从多个结果中选择最佳结果

        优先级：
        1. completed 状态（任务完成）
        2. failed 状态（明确的失败）
        3. in_progress 状态（处理中）
        4. pending 状态（等待中）
        5. 错误响应

        Args:
            results: 所有端点的响应结果列表
            task_id: 任务ID

        Returns:
            最佳结果，如果没有有效结果则返回None
        """
        if not results:
            return None

        # 按优先级排序
        priority = {
            "completed": 1,
            "failed": 2,
            "in_progress": 3,
            "pending": 4,
            "error": 5
        }

        # 筛选成功的结果
        successful_results = [r for r in results if r.get("success")]

        if not successful_results:
            # 都失败了，返回第一个错误
            logger.warning(f"All endpoints failed for task {task_id}, returning first error")
            return results[0] if results else None

        # 选择状态优先级最高的
        best = min(
            successful_results,
            key=lambda r: priority.get(r.get("status", "error"), 99)
        )

        logger.info(
            f"Selected {best.get('endpoint_type')} endpoint result "
            f"with status '{best.get('status')}' for task {task_id}"
        )

        return best

    async def _poll_video_task_dashscope(self, task_id: str) -> Dict[str, Any]:
        """阿里百炼单次轮询视频任务

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

            if response.status_code != 200:
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = f"HTTP {response.status_code}"

                self._log_interaction(
                    interaction_type="video",
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

            result = response.json()

            # 阿里响应格式: output.task_status, output.video_url
            output = result.get("output", {})
            task_status = output.get("task_status")

            logger.info(f"Poll DashScope video task {task_id}: status={task_status}")

            # 状态映射: PENDING/RUNNING -> pending/in_progress, SUCCEEDED -> completed, FAILED -> failed
            status_map = {
                "PENDING": "pending",
                "RUNNING": "in_progress",
                "SUCCEEDED": "completed",
                "FAILED": "failed",
                "CANCELED": "failed"
            }
            normalized_status = status_map.get(task_status, "pending")

            if normalized_status == "completed":
                video_url = output.get("video_url")

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=result,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": True,
                    "status": "completed",
                    "video_url": video_url,
                    "task_id": task_id,
                    "enhanced_prompt": output.get("orig_prompt", ""),
                    "raw_poll_response": result
                }
            elif normalized_status == "failed":
                error_msg = output.get("message") or result.get("message") or "Unknown error"

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=result,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": result
                }
            else:
                # pending 或 in_progress
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=result,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": True,
                    "status": normalized_status,
                    "task_id": task_id,
                    "raw_poll_response": result
                }

        except Exception as e:
            logger.error(f"Error polling DashScope video task {task_id}: {e}")

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = str(e)

            self._log_interaction(
                interaction_type="video",
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

    async def _poll_video_task_local(self, task_id: str) -> Dict[str, Any]:
        """
        本地API视频轮询

        端点：GET {api_url}/videos/{task_id}
        与OpenAI的区别：路径是 /videos/{id} 而不是 /video/task/{id}
        响应格式与OpenAI相同
        """
        # ✅ 使用 /videos/{task_id} 而不是 /video/{task_id}
        task_url = f"{self.api_url}/videos/{task_id}"

        start_time = datetime.now()

        try:
            response = await self.client.get(
                task_url,
                headers=self._get_headers(),
                timeout=30.0
            )

            if response.status_code != 200:
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                error_msg = f"HTTP {response.status_code}"

                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll_local",
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

            result = response.json()
            status = result.get("status")

            logger.info(f"Poll local video task {task_id}: status={status}")

            if status == "completed":
                # 任务成功，尝试从多个位置获取视频URL（与OpenAI相同）
                detail = result.get("detail", {})
                video_url = (
                    detail.get("video_url") or
                    detail.get("url") or
                    result.get("video_url") or
                    result.get("url") or
                    (result.get("data", [{}])[0].get("url") if result.get("data") else None)
                )

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll_local",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=result,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": True,
                    "status": "completed",
                    "video_url": video_url,
                    "task_id": task_id,
                    "enhanced_prompt": detail.get("enhanced_prompt", ""),
                    "raw_poll_response": result
                }
            elif status == "failed":
                error_msg = result.get("detail", {}).get("message", "Unknown error")

                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll_local",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=result,
                    error=error_msg,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": False,
                    "status": "failed",
                    "error": error_msg,
                    "task_id": task_id,
                    "raw_poll_response": result
                }
            else:
                # pending 或其他状态
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                self._log_interaction(
                    interaction_type="video",
                    operation="video_poll_local",
                    url=task_url,
                    method="GET",
                    request_payload={"task_id": task_id},
                    response_data=result,
                    status_code=response.status_code,
                    duration_ms=duration_ms
                )

                return {
                    "success": True,
                    "status": status or "pending",
                    "task_id": task_id,
                    "raw_poll_response": result
                }

        except Exception as e:
            logger.error(f"Error polling local video task {task_id}: {e}")

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_msg = str(e)

            self._log_interaction(
                interaction_type="video",
                operation="video_poll_local",
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

    async def _poll_video_task(
        self,
        task_id: str,
        max_polls: int = 40,
        poll_interval: float = 30.0
    ) -> Dict[str, Any]:
        """轮询视频生成任务状态（每30秒查询一次，最多20分钟）

        查询接口: {api_url}/video/task/{taskId}
        响应格式:
        {
            "id": "veo3:xxx",
            "status": "completed" | "pending" | "failed",
            "detail": {
                "video_url": "https://...",
                ...
            }
        }
        """
        task_url = f"{self.api_url}/video/task/{task_id}"
        poll_history = []  # 记录轮询历史

        for i in range(max_polls):
            poll_record = {
                "attempt": i + 1,
                "time": asyncio.get_event_loop().time(),
                "status": None,
                "raw_response": None,
                "error": None
            }

            try:
                response = await self.client.get(
                    task_url,
                    headers=self._get_headers(),
                    timeout=30.0
                )

                if response.status_code != 200:
                    poll_record["error"] = f"HTTP {response.status_code}"
                    poll_history.append(poll_record)
                    logger.warning(f"Poll attempt {i+1}: HTTP {response.status_code}")
                    await asyncio.sleep(poll_interval)
                    continue

                result = response.json()
                status = result.get("status")

                # 记录原始轮询响应
                poll_record["status"] = status
                poll_record["raw_response"] = result
                poll_history.append(poll_record)

                logger.info(f"Poll attempt {i+1}: status={status}, full response: {result}")

                if status == "completed":
                    # 任务成功，尝试从多个位置获取视频URL
                    detail = result.get("detail", {})
                    # 尝试多个可能的位置
                    video_url = (
                        detail.get("video_url") or
                        detail.get("url") or
                        result.get("video_url") or
                        result.get("url") or
                        (result.get("data", [{}])[0].get("url") if result.get("data") else None)
                    )

                    if video_url:
                        return {
                            "success": True,
                            "video_url": video_url,
                            "status": "completed",
                            "task_id": task_id,
                            "enhanced_prompt": detail.get("enhanced_prompt", "") or result.get("enhanced_prompt", ""),
                            "poll_count": i + 1,
                            "last_poll_response": result,
                            "poll_history": poll_history
                        }
                    else:
                        # video_url 未找到，记录完整响应以便调试
                        logger.error(f"Task completed but no video_url found in response: {result}")
                        return {
                            "success": False,
                            "error": f"Task completed but no video_url found",
                            "task_id": task_id,
                            "poll_count": i + 1,
                            "last_poll_response": result,
                            "poll_history": poll_history
                        }
                elif status == "failed":
                    error_msg = result.get("detail", {}).get("message") or result.get("message") or "Unknown error"
                    return {
                        "success": False,
                        "error": f"Video generation failed: {error_msg}",
                        "task_id": task_id,
                        "poll_count": i + 1,
                        "last_poll_response": result,
                        "poll_history": poll_history
                    }
                elif status == "pending":
                    # 继续轮询
                    await asyncio.sleep(poll_interval)
                else:
                    # 未知状态，继续轮询
                    logger.warning(f"Unknown task status: {status}")
                    await asyncio.sleep(poll_interval)

            except Exception as e:
                poll_record["error"] = str(e)
                poll_history.append(poll_record)
                logger.error(f"Error polling video task {task_id}: {e}")
                await asyncio.sleep(poll_interval)

        return {
            "success": False,
            "error": f"Task timeout after {max_polls * poll_interval} seconds",
            "task_id": task_id,
            "poll_count": max_polls,
            "poll_history": poll_history
        }

def get_ai_service(project_config: Dict, service_type: str, project_id: Optional[str] = None) -> AIService:
    """根据项目配置获取AI服务实例

    Args:
        project_config: 项目配置字典
        service_type: 服务类型 ("llm", "image", "video")
        project_id: 项目ID，用于日志记录

    Returns:
        对应的AI服务实例
    """
    config = project_config.get(service_type, {})

    api_url = config.get("api_url") or getattr(settings, f"DEFAULT_{service_type.upper()}_API_URL")
    api_key = config.get("api_key") or getattr(settings, f"DEFAULT_{service_type.upper()}_API_KEY")
    model = config.get("model") or getattr(settings, f"DEFAULT_{service_type.upper()}_MODEL")
    api_type = config.get("api_type", "openai")  # 默认使用OpenAI格式

    # ✅ 添加调试日志
    logger.info(f"[AI Service] Initializing {service_type} service:")
    logger.info(f"  - api_type: {api_type}")
    logger.info(f"  - api_url: {api_url}")
    logger.info(f"  - model: {model}")

    if service_type == "llm":
        return LLMService(api_url, api_key, model, project_id)
    elif service_type == "image":
        # 阿里百炼需要额外的图像编辑模型
        image_edit_model = config.get("image_edit_model") or settings.DASHSCOPE_IMAGE_EDIT_MODEL
        return ImageGenService(api_url, api_key, model, api_type, image_edit_model, project_id)
    elif service_type == "video":
        use_multipart = config.get("use_multipart", True)  # 从配置读取，默认True（使用文件上传）
        return VideoGenService(api_url, api_key, model, api_type, use_multipart, project_id)
    else:
        raise ValueError(f"Unknown service type: {service_type}")
