"""
大语言模型服务

提供流式和非流式对话功能
"""

import json
import logging
from typing import AsyncIterator, Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.base import AIService

logger = logging.getLogger(__name__)


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

        except Exception as e:
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
        import httpx

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
