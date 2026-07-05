"""
大语言模型服务

提供流式和非流式对话功能，支持 OpenAI Function Calling（tools 参数）
"""

import base64
import json
import logging
import mimetypes
from pathlib import Path
from typing import AsyncIterator, Optional, Dict, Any, List
from datetime import datetime

from app.services.ai.base import AIService

logger = logging.getLogger(__name__)


class LLMService(AIService):
    """大语言模型服务"""

    async def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 32000,
        tools: Optional[List[Dict]] = None,
        response_format: Optional[Dict[str, Any]] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式对话，返回 thinking、content 和 tool_calls。

        当传入 tools 时，启用 OpenAI Function Calling 协议：
        - 若模型返回 finish_reason=="tool_calls"，yield {"type": "tool_calls", "tool_calls": [...]}
        - tool_calls 列表格式：[{"id": ..., "name": ..., "arguments": {...}}]
        - 若模型未返回 tool_calls（fallback 模式），正常 yield content chunk
        """

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

        # 传入工具定义（OpenAI Function Calling）
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        if response_format:
            payload["response_format"] = response_format

        if extra_body:
            payload.update(extra_body)

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

                # tool_calls 累积结构：{index: {id, name, arguments_str}}
                tool_calls_acc: Dict[int, Dict] = {}
                finish_reason = None

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break

                    try:
                        data = json.loads(data_str)
                        choices = data.get("choices")
                        if not isinstance(choices, list) or not choices:
                            logger.warning(
                                "[LLM chat_stream] invalid choices: model=%s keys=%s raw=%s",
                                self.model,
                                list(data.keys()) if isinstance(data, dict) else type(data).__name__,
                                data_str[:500]
                            )
                            continue
                        choice = choices[0]
                        delta = choice.get("delta", {})
                        finish_reason = choice.get("finish_reason") or finish_reason

                        # ── 处理 tool_calls delta ──
                        if "tool_calls" in delta and delta["tool_calls"]:
                            for tc_delta in delta["tool_calls"]:
                                idx = tc_delta.get("index", 0)
                                if idx not in tool_calls_acc:
                                    tool_calls_acc[idx] = {
                                        "id": "",
                                        "name": "",
                                        "arguments_str": ""
                                    }
                                acc = tool_calls_acc[idx]
                                if tc_delta.get("id"):
                                    acc["id"] += tc_delta["id"]
                                func = tc_delta.get("function", {})
                                if func.get("name"):
                                    acc["name"] += func["name"]
                                if func.get("arguments"):
                                    acc["arguments_str"] += func["arguments"]
                            continue  # tool_calls delta 不走下面的 content 路径

                        # ── 处理 thinking ──
                        if "thinking" in delta and delta["thinking"]:
                            in_thinking = True
                            thinking_buffer += delta["thinking"]
                            yield {
                                "type": "thinking",
                                "content": delta["thinking"]
                            }

                        # ── 处理 content ──
                        elif "content" in delta and delta["content"]:
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

                    except (json.JSONDecodeError, KeyError):
                        continue

                # ── 流结束后处理 ──

                # 若有 thinking 未结束
                if thinking_buffer:
                    yield {
                        "type": "thinking_end",
                        "content": thinking_buffer
                    }

                # 若模型触发了 tool_calls（原生 function calling）
                if tool_calls_acc:
                    parsed_tool_calls = []
                    for idx in sorted(tool_calls_acc.keys()):
                        acc = tool_calls_acc[idx]
                        args_str = acc["arguments_str"]
                        try:
                            arguments = json.loads(args_str) if args_str else {}
                        except json.JSONDecodeError:
                            arguments = {"_raw": args_str}
                        parsed_tool_calls.append({
                            "id": acc["id"],
                            "name": acc["name"],
                            "arguments": arguments
                        })
                    yield {
                        "type": "tool_calls",
                        "tool_calls": parsed_tool_calls
                    }
                elif content_buffer:
                    # 普通内容结束
                    yield {
                        "type": "content_end",
                        "content": content_buffer
                    }

        except Exception as e:
            logger.exception("[LLM chat_stream] stream error: model=%s", self.model)
            yield {
                "type": "error",
                "content": f"Network Error: {str(e)}"
            }

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 32000,
        tools: Optional[List[Dict]] = None,
        response_format: Optional[Dict[str, Any]] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """非流式对话，支持 tools"""
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

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        if response_format:
            payload["response_format"] = response_format

        if extra_body:
            payload.update(extra_body)

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

            choices = data.get("choices")
            if not isinstance(choices, list) or not choices:
                logger.error(
                    "[LLM chat] empty/invalid choices: model=%s status=%s keys=%s raw=%s",
                    self.model,
                    response.status_code,
                    list(data.keys()) if isinstance(data, dict) else type(data).__name__,
                    json.dumps(data, ensure_ascii=False)[:1000]
                )
                return {
                    "error": "Invalid LLM response: choices is empty",
                    "raw": data
                }

            message = choices[0].get("message", {})

            # 若模型返回了工具调用
            if message.get("tool_calls"):
                parsed = []
                for tc in message["tool_calls"]:
                    func = tc.get("function", {})
                    args_str = func.get("arguments", "{}")
                    try:
                        arguments = json.loads(args_str)
                    except json.JSONDecodeError:
                        arguments = {"_raw": args_str}
                    parsed.append({
                        "id": tc.get("id", ""),
                        "name": func.get("name", ""),
                        "arguments": arguments
                    })
                return {
                    "tool_calls": parsed,
                    "usage": data.get("usage", {})
                }

            return {
                "content": message.get("content", ""),
                "usage": data.get("usage", {})
            }

        except httpx.HTTPError as e:
            # 记录失败的API调用
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_detail = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_detail = e.response.text
                except Exception:
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

    async def analyze_video(
        self,
        video_path: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 32000,
        extra_body: Optional[Dict[str, Any]] = None,
        preprocess_fps: float = 1.0,
    ) -> Dict[str, Any]:
        """使用 OpenAI 兼容 Responses 协议，以 base64 video_url 单次流式请求分析视频。"""
        import httpx

        path_obj = Path(video_path)
        if not path_obj.exists() or not path_obj.is_file():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        file_size = path_obj.stat().st_size
        max_file_size = 45 * 1024 * 1024
        if file_size > max_file_size:
            return {
                "error": "视频文件超过 45MB，Base64 视频输入无法处理，请压缩视频后重试。",
                "raw": {"file_size": file_size, "max_file_size": max_file_size},
            }

        mime_type = mimetypes.guess_type(path_obj.name)[0] or "video/mp4"
        video_base64 = base64.b64encode(path_obj.read_bytes()).decode("ascii")
        video_url = f"data:{mime_type};base64,{video_base64}"
        response_url = f"{self.api_url}/responses"
        response_payload: Dict[str, Any] = {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_video", "video_url": video_url, "fps": preprocess_fps},
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
            "stream": True,
        }
        if system_prompt:
            response_payload["instructions"] = system_prompt
        if temperature is not None:
            response_payload["temperature"] = temperature
        if max_output_tokens is not None:
            response_payload["max_output_tokens"] = max_output_tokens
        if extra_body:
            response_payload.update(extra_body)
        response_payload["stream"] = True

        request_payload_for_log = {
            **response_payload,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_video", "video_url": f"data:{mime_type};base64,<omitted>", "fps": preprocess_fps, "file_size": file_size},
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
        }

        start_time = datetime.now()
        output_parts: List[str] = []
        event_types: List[str] = []
        final_response_data: Optional[Dict[str, Any]] = None
        printed_stream_header = False

        try:
            async with self.client.stream(
                "POST",
                response_url,
                headers=self._get_headers(),
                json=response_payload,
                timeout=None,
            ) as inference_response:
                inference_response.raise_for_status()
                async for raw_line in inference_response.aiter_lines():
                    line = (raw_line or "").strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line == "[DONE]":
                        break

                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        logger.debug("无法解析视频分析流式行: %s", line[:500])
                        continue
                    if not isinstance(event, dict):
                        continue

                    event_type = event.get("type")
                    if isinstance(event_type, str):
                        event_types.append(event_type)
                    if event_type in {"response.completed", "response.done"} and isinstance(event.get("response"), dict):
                        final_response_data = event["response"]

                    delta = self._extract_response_stream_delta(event)
                    if delta:
                        output_parts.append(delta)
                        if not printed_stream_header:
                            print("\n[VLM视频反推流式输出开始]", flush=True)
                            printed_stream_header = True
                        print(delta, end="", flush=True)

            if printed_stream_header:
                print("\n[VLM视频反推流式输出结束]", flush=True)

            output_text = "".join(output_parts).strip()
            if not output_text and final_response_data:
                output_text = self._extract_response_text(final_response_data)

            usage = final_response_data.get("usage", {}) if final_response_data else {}
            response_data: Dict[str, Any] = {
                "stream": True,
                "events": event_types[-200:],
                "output_text": output_text,
            }
            if final_response_data:
                response_data["response"] = final_response_data

            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="llm",
                operation="analyze_video_response_stream",
                url=response_url,
                method="POST",
                request_payload=request_payload_for_log,
                response_data=response_data,
                status_code=200,
                duration_ms=duration_ms,
            )

            if not output_text:
                return {
                    "error": "Invalid VLM response: empty stream content",
                    "raw": response_data,
                    "usage": usage,
                }

            return {
                "content": output_text,
                "raw": response_data,
                "usage": usage,
            }

        except httpx.HTTPError as e:
            if printed_stream_header:
                print("\n[VLM视频反推流式输出异常]", flush=True)
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            error_detail = str(e)
            status_code = None
            if hasattr(e, "response") and e.response is not None:
                status_code = e.response.status_code
                try:
                    error_detail = e.response.text
                except Exception:
                    pass

            self._log_interaction(
                interaction_type="llm",
                operation="analyze_video_response_stream",
                url=response_url,
                method="POST",
                request_payload=request_payload_for_log,
                error=error_detail,
                status_code=status_code,
                duration_ms=duration_ms,
            )
            return {
                "error": error_detail,
                "raw": None,
            }

    def _extract_response_stream_delta(self, event: Dict[str, Any]) -> str:
        """从 Responses/Chat 兼容流式事件中提取文本增量。"""
        delta = event.get("delta")
        if isinstance(delta, str):
            return delta
        if isinstance(delta, dict):
            text = delta.get("text") or delta.get("content") or delta.get("value")
            if isinstance(text, str):
                return text

        text = event.get("text") or event.get("content") or event.get("output_text")
        if isinstance(text, str):
            return text

        choices = event.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                first_delta = first.get("delta") or {}
                if isinstance(first_delta, dict):
                    content = first_delta.get("content")
                    if isinstance(content, str):
                        return content
                message = first.get("message") or {}
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str):
                        return content

        return ""

    def _extract_response_text(self, response_data: Dict[str, Any]) -> str:
        """从 OpenAI Responses 风格响应中提取文本。"""
        output_text = response_data.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

        texts: List[str] = []
        for item in response_data.get("output", []):
            if not isinstance(item, dict):
                continue
            for content in item.get("content", []):
                if not isinstance(content, dict):
                    continue
                text_value = content.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    texts.append(text_value.strip())
                    continue
                if isinstance(text_value, dict):
                    nested_text = text_value.get("value") or text_value.get("text")
                    if isinstance(nested_text, str) and nested_text.strip():
                        texts.append(nested_text.strip())
                        continue
                if content.get("type") in {"output_text", "text"}:
                    nested_text = content.get("value")
                    if isinstance(nested_text, str) and nested_text.strip():
                        texts.append(nested_text.strip())

        return "\n".join(texts).strip()
