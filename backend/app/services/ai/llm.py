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

    async def upload_video_file(
        self,
        video_path: str,
        preprocess_fps: float = 1.0,
    ) -> Dict[str, Any]:
        """Upload a video once through the Files API and return its file_id."""
        import httpx

        path_obj = Path(video_path)
        if not path_obj.exists() or not path_obj.is_file():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        upload_url = f"{self.api_url}/files"
        mime_type = mimetypes.guess_type(path_obj.name)[0] or "video/mp4"
        start_time = datetime.now()
        file_size = path_obj.stat().st_size

        try:
            with path_obj.open("rb") as handle:
                files = {
                    "model": (None, self.model),
                    "purpose": (None, "user_data"),
                    "file": (path_obj.name, handle, mime_type),
                    "preprocess_configs[video][fps]": (None, str(preprocess_fps)),
                }
                response = await self.client.post(
                    upload_url,
                    headers=self._get_headers(exclude_content_type=True),
                    files=files,
                    timeout=None,
                )
            response.raise_for_status()
            response_data = response.json()
            file_id = response_data.get("id") or response_data.get("file_id")
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="llm",
                operation="upload_video_file",
                url=upload_url,
                method="POST",
                request_payload={
                    "model": self.model,
                    "purpose": "user_data",
                    "filename": path_obj.name,
                    "mime_type": mime_type,
                    "file_size": file_size,
                    "preprocess_configs": {"video": {"fps": preprocess_fps}},
                },
                response_data=response_data,
                status_code=response.status_code,
                duration_ms=duration_ms,
            )
            if not file_id:
                return {"error": "Files API response missing file id", "raw": response_data}
            return {"file_id": file_id, "raw": response_data}
        except httpx.HTTPError as e:
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
                operation="upload_video_file",
                url=upload_url,
                method="POST",
                request_payload={"model": self.model, "filename": path_obj.name, "file_size": file_size, "preprocess_fps": preprocess_fps},
                error=error_detail,
                status_code=status_code,
                duration_ms=duration_ms,
            )
            return {"error": error_detail, "raw": None}

    async def wait_video_file_ready(
        self,
        file_id: str,
        poll_interval_seconds: float = 30.0,
        timeout_seconds: float = 300.0,
    ) -> Dict[str, Any]:
        """Poll Files API until the uploaded video can be referenced by responses."""
        import asyncio
        import httpx

        file_url = f"{self.api_url}/files/{file_id}"
        start_time = datetime.now()
        ready_statuses = {"processed", "ready", "completed", "succeeded", "success", "available", "uploaded", "active"}
        pending_statuses = {"processing", "pending", "queued", "running", "in_progress"}
        failed_statuses = {"failed", "error", "cancelled", "canceled", "expired"}
        last_data: Dict[str, Any] = {}

        while (datetime.now() - start_time).total_seconds() < timeout_seconds:
            try:
                file_headers = self._get_headers()
                file_headers["x-proxy-model"] = self.model
                response = await self.client.get(file_url, headers=file_headers, timeout=None)
                response.raise_for_status()
                data = response.json()
                last_data = data if isinstance(data, dict) else {"data": data}
                status = str(last_data.get("status") or last_data.get("state") or "").lower()
                if not status or status in ready_statuses:
                    duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                    self._log_interaction(
                        interaction_type="llm",
                        operation="wait_video_file_ready",
                        url=file_url,
                        method="GET",
                        request_payload={"file_id": file_id},
                        response_data=last_data,
                        status_code=response.status_code,
                        duration_ms=duration_ms,
                    )
                    return {"file_id": file_id, "status": status or "unknown", "raw": last_data}
                if status in failed_statuses:
                    return {"error": f"Video file preprocessing failed: {status}", "raw": last_data}
                if status not in pending_statuses:
                    logger.info("Unknown video file status for %s: %s", file_id, status)
                await asyncio.sleep(poll_interval_seconds)
            except httpx.HTTPError as e:
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
                    operation="wait_video_file_ready",
                    url=file_url,
                    method="GET",
                    request_payload={"file_id": file_id},
                    error=error_detail,
                    status_code=status_code,
                    duration_ms=duration_ms,
                )
                return {"error": error_detail, "raw": last_data or None}

        return {"error": f"Video file preprocessing timed out after {timeout_seconds:.0f}s", "raw": last_data or None}

    async def analyze_video_file(
        self,
        file_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 128000,
        extra_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Analyze an uploaded video by referencing file_id through Responses API."""
        import httpx

        response_url = f"{self.api_url}/responses"
        response_payload: Dict[str, Any] = {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_video", "file_id": file_id},
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
        }
        if system_prompt:
            response_payload["instructions"] = system_prompt
        if temperature is not None:
            response_payload["temperature"] = temperature
        if max_output_tokens is not None:
            response_payload["max_output_tokens"] = max_output_tokens
        if extra_body:
            response_payload.update(extra_body)

        start_time = datetime.now()
        # 阶段观测点 1：请求发出前
        self._log_interaction(
            interaction_type="llm",
            operation="analyze_video_file_stage",
            url=response_url,
            method="POST",
            request_payload={"model": self.model, "stage": "request_sent"},
            metadata={"stage": "request_sent"},
        )
        try:
            # 用 stream 把“响应头到达”和“响应体收完”拆成两个可观测的时刻
            # （普通 .post 会一次性等完整响应体，无法区分卡在哪个阶段）
            async with self.client.stream(
                "POST",
                response_url,
                headers=self._get_headers(),
                json=response_payload,
                timeout=None,
            ) as response:
                # 阶段观测点 2：响应头已到达（status_code 可用；体可能还没收完）
                self._log_interaction(
                    interaction_type="llm",
                    operation="analyze_video_file_stage",
                    url=response_url,
                    method="POST",
                    request_payload={"model": self.model, "stage": "headers_received"},
                    metadata={"stage": "headers_received"},
                    status_code=response.status_code,
                )
                response.raise_for_status()
                # 阶段观测点 3：响应体收完（卡在这之前 = 体没有完整送达）
                body = await response.aread()
                self._log_interaction(
                    interaction_type="llm",
                    operation="analyze_video_file_stage",
                    url=response_url,
                    method="POST",
                    request_payload={"model": self.model, "stage": "body_received"},
                    metadata={"stage": "body_received"},
                    status_code=response.status_code,
                )
                response_data = json.loads(body) if body else {}
            output_text = self._extract_response_text(response_data)
            duration_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._log_interaction(
                interaction_type="llm",
                operation="analyze_video_file_response",
                url=response_url,
                method="POST",
                request_payload=response_payload,
                response_data=response_data,
                status_code=response.status_code,
                duration_ms=duration_ms,
            )
            if not output_text:
                return {"error": "Invalid VLM response: empty content", "raw": response_data, "usage": response_data.get("usage", {})}
            return {"content": output_text, "raw": response_data, "usage": response_data.get("usage", {})}
        except httpx.HTTPError as e:
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
                operation="analyze_video_file_response",
                url=response_url,
                method="POST",
                request_payload=response_payload,
                error=error_detail,
                status_code=status_code,
                duration_ms=duration_ms,
            )
            return {"error": error_detail, "raw": None}

    async def analyze_video(
        self,
        video_path: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 128000,
        extra_body: Optional[Dict[str, Any]] = None,
        preprocess_fps: float = 1.0,
    ) -> Dict[str, Any]:
        """Upload a video once and analyze it by file_id for backward compatibility."""
        upload_result = await self.upload_video_file(video_path, preprocess_fps=preprocess_fps)
        if upload_result.get("error"):
            return upload_result
        file_id = upload_result["file_id"]
        ready_result = await self.wait_video_file_ready(file_id)
        if ready_result.get("error"):
            return ready_result
        return await self.analyze_video_file(
            file_id=file_id,
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            extra_body=extra_body,
        )

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
