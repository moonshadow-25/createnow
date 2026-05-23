from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
import asyncio
import json
import re
import uuid
import time
import logging
from datetime import datetime

from app.services import get_ai_service, AssetService, ScriptService, ScriptParser
from app.api.tools import OPENAI_TOOLS, ASSET_ONLY_TOOLS, CONFIRMATION_REQUIRED_TOOLS, execute_tool_call
from app.models.project import normalize_global_style_config

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["conversation"])
logger = logging.getLogger(__name__)

# 待确认操作缓存（进程内存，TTL 10 分钟）
_pending_confirmations: Dict[str, Dict] = {}  # token → {tool_name, parameters, project_id, ts}


def _safe_format(template: str, **kwargs) -> str:
    """安全模板替换，只替换已知占位符，含 { } 的模板内容不会崩溃"""
    for k, v in kwargs.items():
        template = template.replace("{" + k + "}", str(v))
    return template


def _build_system_prompt(project: Dict, ai_config: Dict, episode_id: Optional[str] = None) -> tuple[str, str]:
    """
    构建真实的 system_prompt 和 tools_desc。
    stream_conversation 和 debug-prompt 均调用此函数，保证两者完全一致。
    返回 (system_prompt, tools_desc)
    """
    from app.services.global_prompt_service import get_prompt_content, load_prompts as _load_prompts

    is_storyboard_tab = bool(episode_id)

    # 工具描述
    tools_desc = get_prompt_content("conversation_tools_desc", ai_config) or ""

    # ai_formats_context：三类格式规范
    _prompts_data = _load_prompts()
    _FORMAT_KEYS = [
        ("video",               "视频提示词（video_prompt）格式规范"),
        ("image",               "资产图片提示词（角色/场景/道具 image_prompt）格式规范"),
        ("storyboard_image_edit", "分镜图生图提示词（storyboard image_prompt）格式规范"),
    ]
    _format_parts = []
    _overrides = ai_config.get("prompt_overrides", {})
    for _key, _label in _FORMAT_KEYS:
        _active = (_overrides.get(_key) or {}).get("active", "")
        _presets = _prompts_data.get(_key, {}).get("presets", {})
        if _active.startswith("custom"):
            _custom = (_overrides[_key].get("custom") or {}).get(_active, {})
            _fmt_content = _custom.get("content", "")
        else:
            _fmt_content = (_presets.get("default_ai", {}).get("content", "")
                            or _presets.get("default", {}).get("content", ""))
        if _fmt_content:
            _format_parts.append(f"### {_label}\n\n{_fmt_content}")
    ai_formats_context = (
        "## 📋 生成格式规范（直接使用，无需调用工具读取）\n\n"
        + "\n\n---\n\n".join(_format_parts)
    ) if _format_parts else ""

    # T1 + T2
    _conv_tpl = get_prompt_content("conversation_system_prompt", ai_config)
    system_prompt = _safe_format(
        _conv_tpl or "",
        tools_desc=tools_desc,
        ai_formats_context=ai_formats_context,
        project_context="",
    )
    _ai_instructions = project.get("ai_instructions", "").strip()
    if _ai_instructions:
        system_prompt += f"\n\n## 项目自定义指令（优先级最高，严格遵守）\n{_ai_instructions}"

    if episode_id:
        system_prompt += f"\n\n## 当前工作上下文\n当前正在编辑的剧集 episode_id = `{episode_id}`\n调用 get_storyboard / update_storyboard / insert_storyboard / delete_storyboard / get_episode_storyboards 时，episode_id 字段必须填写此值，禁止使用其他值或自行编造。"

    # 注入全局风格（让 AI 写提示词时融入风格，与生成侧逻辑保持一致）
    from app.api.generation.style_presets import get_video_style_suffix, get_image_style_suffix
    global_style_cfg = normalize_global_style_config(ai_config.get("global_style_config"))
    language = global_style_cfg.get("prompt_language", "zh")

    def _build_style_text(style_cfg: dict, get_suffix_fn) -> str:
        if not style_cfg.get("enabled", True):
            return ""
        preset_id = style_cfg.get("preset_id", "none")
        custom = style_cfg.get("custom_suffix", "").strip()
        if preset_id == "custom":
            return custom
        elif preset_id != "none":
            return get_suffix_fn(preset_id, language)
        return ""

    video_style_text = _build_style_text(global_style_cfg.get("video_style", {}), get_video_style_suffix)
    image_style_text = _build_style_text(global_style_cfg.get("image_style", {}), get_image_style_suffix)

    if video_style_text or image_style_text:
        style_lines = ["## 当前项目全局风格（写提示词时必须融入，不得忽略）"]
        if video_style_text:
            style_lines.append(f"- 视频风格（video_prompt 画风/色调字段）：{video_style_text}")
        if image_style_text:
            style_lines.append(f"- 图片风格（image_prompt 风格字段）：{image_style_text}")
        system_prompt += "\n\n" + "\n".join(style_lines)

    return system_prompt, tools_desc


class ChatMessage(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    episode_id: Optional[str] = None  # 当前工作剧集ID
    context_messages: Optional[List[Dict]] = None  # 浏览器端存储的历史消息


async def stream_conversation(project_id: str, message: str, conversation_id: Optional[str] = None, episode_id: Optional[str] = None, context_messages: Optional[List[Dict]] = None):
    """流式对话处理，支持Function Calling和Agentic Loop"""

    # 清理过期的待确认操作（TTL 1 小时）
    now = time.time()
    expired = [t for t, v in _pending_confirmations.items() if now - v.get("ts", 0) > 3600]
    for t in expired:
        _pending_confirmations.pop(t, None)

    # ── 特殊消息：确认/取消待执行操作 ──
    if message.startswith("__CONFIRM__:"):
        token = message.split(":", 1)[1].strip()
        pending = _pending_confirmations.pop(token, None)
        if pending and pending.get("project_id") == project_id:
            # 先发 tool_call 事件，让前端显示工具调用 tips
            yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': {'id': token, 'name': pending['tool_name'], 'parameters': pending['parameters']}}, ensure_ascii=False)}\n\n"
            # 用户已确认，注入 confirmed=True（供 handler 内部检查使用）
            confirmed_params = {**pending["parameters"], "confirmed": True}
            result = await execute_tool_call(project_id, pending["tool_name"], confirmed_params, pending.get("ai_config"))
            desc = pending["parameters"].get("description", pending["tool_name"])
            if result.get("success"):
                yield f"data: {json.dumps({'type': 'content', 'content': f'✓ 已执行：{desc}'})}\n\n"
                # 发送 tool_result 事件（供前端流水线逻辑使用）
                yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': pending['tool_name'], 'tool_call_id': token, 'result': f'✓ 已执行：{desc}', 'raw_result': result}, ensure_ascii=False)}\n\n"
            else:
                _err_msg = result.get("error", "未知错误")
                detail_lines = []
                guard = result.get("asset_order_guard") or {}
                attempts = result.get("attempts") or []
                if guard:
                    detail_lines.append(f"expected: {json.dumps(guard.get('expected') or [], ensure_ascii=False)}")
                    detail_lines.append(f"actual: {json.dumps(guard.get('actual') or [], ensure_ascii=False)}")
                    detail_lines.append(f"mismatches: {json.dumps(guard.get('mismatches') or [], ensure_ascii=False)}")
                if attempts:
                    detail_lines.append(f"attempt_count: {len(attempts)}")
                _final_err_text = f"❌ 执行失败：{_err_msg}"
                if detail_lines:
                    _final_err_text += "\n" + "\n".join(detail_lines)
                yield f"data: {json.dumps({'type': 'content', 'content': _final_err_text}, ensure_ascii=False)}\n\n"
                # 失败时也必须发 tool_result + raw_result，前端才能拿到完整诊断
                yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': pending['tool_name'], 'tool_call_id': token, 'result': _final_err_text, 'raw_result': result}, ensure_ascii=False)}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'content', 'content': '确认已过期或无效。'})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation_id or ''})}\n\n"
        return

    if message.startswith("__CANCEL__:"):
        token = message.split(":", 1)[1].strip()
        _pending_confirmations.pop(token, None)
        yield f"data: {json.dumps({'type': 'content', 'content': '已取消操作。'})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation_id or ''})}\n\n"
        return

    # 加载项目配置
    from app.services import ProjectService
    project = ProjectService.get_project(project_id)
    if not project:
        yield f"data: {json.dumps({'type': 'error', 'content': 'Project not found'})}\n\n"
        return

    ai_config = project.get("ai_config", {})

    # 检查API配置
    llm_config = ai_config.get("llm", {})
    if not llm_config.get("api_key"):
        yield f"data: {json.dumps({'type': 'error', 'content': '请先配置LLM API密钥（点击右上角设置图标）'})}\n\n"
        return

    # 获取对话上下文：使用浏览器端传来的历史（用户级隔离）
    # 不截断历史：system prompt 固定时 Anthropic 会对其做 prompt cache，
    # 截断 messages 只会导致 cache miss，反而多花钱（AI 还会重复调工具找回丢失信息）
    if context_messages is not None:
        context = [{"role": m["role"], "content": m["content"]} for m in context_messages if "role" in m and "content" in m]
        context.append({"role": "user", "content": message})
    else:
        context = [{"role": "user", "content": message}]

    is_storyboard_tab = bool(episode_id)

    # 构建 system_prompt 和 tools_desc（与 debug-prompt 端点共用同一函数，保证一致）
    system_prompt, tools_desc = _build_system_prompt(project, ai_config, episode_id)

    # 创建LLM服务
    llm = get_ai_service(ai_config, "llm")

    # 选择工具集（分镜 tab 用全集，资产 tab 用无分镜子集）
    active_tools = OPENAI_TOOLS if is_storyboard_tab else ASSET_ONLY_TOOLS

    # 构建初始消息列表（不预加载资产/分镜，AI 通过工具按需查询）
    loop_messages = list(context)

    MAX_ITERATIONS = 20
    all_thinking_content = ""
    all_assistant_content = ""

    try:
        for iteration in range(MAX_ITERATIONS):
            thinking_buffer = ""
            content_buffer = ""
            native_tool_calls = []  # 原生 function calling 结果

            async for chunk in llm.chat_stream(loop_messages, system_prompt, tools=active_tools):
                chunk_type = chunk.get("type")
                chunk_content = chunk.get("content", "")

                if chunk_type == "thinking":
                    thinking_buffer += chunk_content
                    yield f"data: {json.dumps({'type': 'thinking', 'content': chunk_content})}\n\n"

                elif chunk_type == "thinking_end":
                    yield f"data: {json.dumps({'type': 'thinking_end', 'content': thinking_buffer})}\n\n"

                elif chunk_type == "content":
                    content_buffer += chunk_content
                    yield f"data: {json.dumps({'type': 'content', 'content': chunk_content})}\n\n"

                elif chunk_type == "content_end":
                    yield f"data: {json.dumps({'type': 'content_end', 'content': content_buffer})}\n\n"

                elif chunk_type == "tool_calls":
                    # 原生 Function Calling：模型返回了 tool_calls
                    native_tool_calls = chunk.get("tool_calls", [])

                elif chunk_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': chunk_content})}\n\n"

            all_thinking_content += thinking_buffer
            all_assistant_content += content_buffer

            # ── 解析工具调用 ──
            # 优先使用原生 Function Calling 结果；若无，回退到文本解析（兼容本地模型）
            tool_calls = []

            if native_tool_calls:
                # 原生模式：直接使用解析好的结构
                for tc in native_tool_calls:
                    tool_calls.append({
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "parameters": tc.get("arguments", {})
                    })
                print(f"[DEBUG] Iteration {iteration+1}: {len(tool_calls)} native tool_calls")
            else:
                # Fallback：从文本中正则解析（本地/不支持 function calling 的模型）
                text_tool_calls = []
                tool_pattern = r'TOOL:\s*(\w+)\s*\n(.*?)\nEND_TOOL'
                tool_matches = re.findall(tool_pattern, content_buffer, re.DOTALL)
                for tool_name_txt, params_json in tool_matches:
                    try:
                        params = json.loads(params_json.strip())
                        text_tool_calls.append({"name": tool_name_txt, "parameters": params})
                    except Exception:
                        pass
                for tc in text_tool_calls:
                    tool_calls.append({
                        "id": str(uuid.uuid4()),
                        "name": tc.get("name", ""),
                        "parameters": tc.get("parameters", {})
                    })
                if tool_calls:
                    print(f"[DEBUG] Iteration {iteration+1}: {len(tool_calls)} text-fallback tool_calls")

            # 若无工具调用，本轮结束
            if not tool_calls:
                break

            # ── 执行所有工具调用，收集结果 ──
            STORYBOARD_TOOLS = {
                "create_storyboard", "update_storyboard", "delete_storyboard",
                "insert_storyboard", "generate_storyboard", "create_child_asset"
            }

            # 构建 assistant 消息（含 tool_calls，按 OpenAI 协议）
            assistant_msg: Dict[str, Any] = {"role": "assistant"}
            if native_tool_calls:
                # 原生模式：assistant 消息携带 tool_calls
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.get("id", ""),
                        "type": "function",
                        "function": {
                            "name": tc.get("name", ""),
                            "arguments": json.dumps(tc.get("arguments", {}), ensure_ascii=False)
                        }
                    }
                    for tc in native_tool_calls
                ]
                if content_buffer:
                    assistant_msg["content"] = content_buffer
                else:
                    assistant_msg["content"] = None
            else:
                # Fallback 模式：assistant 消息为纯文本
                assistant_msg["content"] = content_buffer

            loop_messages.append(assistant_msg)

            # 执行工具并构建 tool 角色消息
            tool_result_msgs = []
            tool_results_lines = []  # 用于 fallback 模式的文本汇总

            def format_tool_result(result: Dict) -> str:
                """将工具结果格式化为易读的文本格式，保留换行符"""
                if not isinstance(result, dict):
                    return str(result)
                lines = []
                for key, value in result.items():
                    if isinstance(value, (list, dict)):
                        lines.append(f"{key}: {json.dumps(value, ensure_ascii=False, indent=2)}")
                    elif isinstance(value, str) and '\n' in value:
                        lines.append(f"{key}:\n{value}")
                    else:
                        lines.append(f"{key}: {value}")
                return "\n".join(lines)

            def build_error_message(tool_name: str, result: Dict) -> str:
                error_msg = f'❌ 失败: {result.get("error", "未知错误")}'
                if tool_name == "generate_storyboard_video_prompt_subagent":
                    detail_lines = []
                    guard = result.get("asset_order_guard") or {}
                    attempts = result.get("attempts") or []
                    if guard:
                        expected = guard.get("expected") or []
                        actual = guard.get("actual") or []
                        mismatches = guard.get("mismatches") or []
                        detail_lines.append(f"expected: {json.dumps(expected, ensure_ascii=False)}")
                        detail_lines.append(f"actual: {json.dumps(actual, ensure_ascii=False)}")
                        detail_lines.append(f"mismatches: {json.dumps(mismatches, ensure_ascii=False)}")
                    if attempts:
                        detail_lines.append(f"attempt_count: {len(attempts)}")
                        last_attempt = attempts[-1]
                        last_preview = (last_attempt.get("prompt_preview") or "")
                        if last_preview:
                            detail_lines.append(f"last_prompt_preview: {last_preview[:240]}")
                    if detail_lines:
                        error_msg = error_msg + "\n" + "\n".join(detail_lines)
                return error_msg

            pending_confirm_triggered = False
            parallel_tool_name = "generate_storyboard_video_prompt_subagent"
            can_parallel_subagent = len(tool_calls) > 1 and all((tc.get("name", "") == parallel_tool_name) for tc in tool_calls)

            if can_parallel_subagent:
                exec_items = []
                for tool_call in tool_calls:
                    tool_id = tool_call.get("id", str(uuid.uuid4()))
                    tool_name = tool_call.get("name", "")
                    parameters = tool_call.get("parameters", {})

                    yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': {'id': tool_id, 'name': tool_name, 'parameters': parameters}}, ensure_ascii=False)}\n\n"

                    if not is_storyboard_tab and tool_name in STORYBOARD_TOOLS:
                        error_msg = "❌ 当前界面（资产管理）不允许执行分镜操作"
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'tool_call_id': tool_id, 'result': error_msg, 'raw_result': {'success': False, 'error': error_msg}}, ensure_ascii=False)}\n\n"
                        tool_result_msgs.append({"role": "tool", "tool_call_id": tool_id, "content": f"success: False\nerror: {error_msg}"})
                        tool_results_lines.append(f"{tool_name} → {error_msg}")
                        continue

                    if tool_name in CONFIRMATION_REQUIRED_TOOLS:
                        token = str(uuid.uuid4())[:8]
                        _pending_confirmations[token] = {
                            "tool_name": tool_name,
                            "parameters": parameters,
                            "project_id": project_id,
                            "ai_config": ai_config,
                            "ts": time.time(),
                        }
                        desc = parameters.get("description", f"执行 {tool_name}")
                        yield f"data: {json.dumps({'type': 'confirmation_required', 'token': token, 'tool_name': tool_name, 'description': desc})}\n\n"
                        tool_results_lines.append(f"{tool_name} → [等待用户确认]")
                        tool_result_msgs.append({"role": "tool", "tool_call_id": tool_id, "content": "pending_confirmation: 操作已提交用户确认，等待确认后执行"})
                        pending_confirm_triggered = True
                        break

                    exec_items.append({"tool_id": tool_id, "tool_name": tool_name, "parameters": parameters})

                if not pending_confirm_triggered and exec_items:
                    semaphore = asyncio.Semaphore(4)

                    async def _run_one(item: Dict[str, Any]) -> Dict[str, Any]:
                        async with semaphore:
                            result = await execute_tool_call(project_id, item["tool_name"], item["parameters"], ai_config)
                            return {"tool_id": item["tool_id"], "tool_name": item["tool_name"], "result": result}

                    run_results = await asyncio.gather(*[_run_one(item) for item in exec_items], return_exceptions=True)

                    for rr in run_results:
                        if isinstance(rr, Exception):
                            synthetic = {"success": False, "error": str(rr)}
                            tool_id = ""
                            tool_name = parallel_tool_name
                            result = synthetic
                        else:
                            tool_id = rr["tool_id"]
                            tool_name = rr["tool_name"]
                            result = rr["result"]

                        logger.info(
                            "[tool_result_debug] tool=%s success=%s keys=%s attempt_count=%s has_attempts=%s has_guard=%s",
                            tool_name,
                            result.get("success") if isinstance(result, dict) else None,
                            list(result.keys()) if isinstance(result, dict) else [],
                            result.get("attempt_count") if isinstance(result, dict) else None,
                            bool(result.get("attempts")) if isinstance(result, dict) else False,
                            bool(result.get("asset_order_guard")) if isinstance(result, dict) else False,
                        )

                        result_text = format_tool_result(result)

                        if isinstance(result, dict) and result.get("success"):
                            success_msg = f'✅ {tool_name} 操作成功'
                            yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'tool_call_id': tool_id, 'result': success_msg, 'raw_result': result}, ensure_ascii=False)}\n\n"
                            tool_results_lines.append(f"{tool_name} → {success_msg}")
                        else:
                            safe_result = result if isinstance(result, dict) else {"error": str(result)}
                            error_msg = build_error_message(tool_name, safe_result)
                            yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'tool_call_id': tool_id, 'result': error_msg, 'raw_result': safe_result}, ensure_ascii=False)}\n\n"
                            tool_results_lines.append(f"{tool_name} → {error_msg}")

                        tool_result_msgs.append({"role": "tool", "tool_call_id": tool_id, "content": result_text})

            else:
                for tool_call in tool_calls:
                    tool_id = tool_call.get("id", str(uuid.uuid4()))
                    tool_name = tool_call.get("name", "")
                    parameters = tool_call.get("parameters", {})

                    # 发送工具调用通知给前端
                    yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': {'id': tool_id, 'name': tool_name, 'parameters': parameters}}, ensure_ascii=False)}\n\n"

                    # Layer 3：资产 tab 硬拦截分镜工具
                    if not is_storyboard_tab and tool_name in STORYBOARD_TOOLS:
                        error_msg = "❌ 当前界面（资产管理）不允许执行分镜操作"
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'tool_call_id': tool_id, 'result': error_msg, 'raw_result': {'success': False, 'error': error_msg}}, ensure_ascii=False)}\n\n"
                        tool_result_msgs.append({
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "content": f"success: False\nerror: {error_msg}"
                        })
                        tool_results_lines.append(f"{tool_name} → {error_msg}")
                        continue

                    # Layer 4：需要用户确认的工具 — 暂存并通知前端，本轮停止执行
                    if tool_name in CONFIRMATION_REQUIRED_TOOLS:
                        token = str(uuid.uuid4())[:8]
                        _pending_confirmations[token] = {
                            "tool_name": tool_name,
                            "parameters": parameters,
                            "project_id": project_id,
                            "ai_config": ai_config,
                            "ts": time.time(),
                        }
                        desc = parameters.get("description", f"执行 {tool_name}")
                        yield f"data: {json.dumps({'type': 'confirmation_required', 'token': token, 'tool_name': tool_name, 'description': desc})}\n\n"
                        tool_results_lines.append(f"{tool_name} → [等待用户确认]")
                        tool_result_msgs.append({
                            "role": "tool",
                            "tool_call_id": tool_id,
                            "content": "pending_confirmation: 操作已提交用户确认，等待确认后执行"
                        })
                        pending_confirm_triggered = True
                        break

                    result = await execute_tool_call(project_id, tool_name, parameters, ai_config)

                    logger.info(
                        "[tool_result_debug] tool=%s success=%s keys=%s attempt_count=%s has_attempts=%s has_guard=%s",
                        tool_name,
                        result.get("success"),
                        list(result.keys()) if isinstance(result, dict) else [],
                        result.get("attempt_count") if isinstance(result, dict) else None,
                        bool(result.get("attempts")) if isinstance(result, dict) else False,
                        bool(result.get("asset_order_guard")) if isinstance(result, dict) else False,
                    )

                    result_text = format_tool_result(result)

                    if result.get("success"):
                        if tool_name == "create_storyboard":
                            success_msg = f'✅ 成功创建第{result.get("sequence", "")}镜'
                        elif tool_name == "insert_storyboard":
                            moved = result.get("moved_count", 0)
                            success_msg = f'✅ 成功在第{result.get("sequence", "")}镜位置插入新分镜' + (f'，已将{moved}个后续分镜后移' if moved > 0 else '')
                        elif tool_name == "update_storyboard":
                            success_msg = f'✅ 成功更新第{result.get("sequence", "")}镜'
                        elif tool_name == "delete_storyboard":
                            success_msg = f'✅ 成功删除分镜'
                        elif "name" in result:
                            success_msg = f'✅ 成功创建: {result.get("name", tool_name)}'
                        else:
                            success_msg = f'✅ {tool_name} 操作成功'
                        extra = {}
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'tool_call_id': tool_id, 'result': success_msg, 'raw_result': result, **extra}, ensure_ascii=False)}\n\n"
                        tool_results_lines.append(f"{tool_name} → {success_msg}")
                    else:
                        error_msg = build_error_message(tool_name, result)
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'tool_call_id': tool_id, 'result': error_msg, 'raw_result': result}, ensure_ascii=False)}\n\n"
                        tool_results_lines.append(f"{tool_name} → {error_msg}")

                    tool_result_msgs.append({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": result_text
                    })

            if native_tool_calls:
                # 原生模式：追加 tool 角色消息列表
                loop_messages.extend(tool_result_msgs)
            else:
                # Fallback 模式：用 user 角色汇总工具结果（兼容不支持 role=tool 的模型）
                tool_results_text = "\n".join(tool_results_lines)
                loop_messages.append({
                    "role": "user",
                    "content": f"工具执行结果：\n{tool_results_text}\n\n请继续完成剩余任务。若所有任务已完成，请向用户汇报结果。"
                })

            if pending_confirm_triggered:
                break

        else:
            # 达到最大迭代次数
            yield f"data: {json.dumps({'type': 'content', 'content': '\n\n[已达最大操作轮次，请继续发消息完成剩余任务]'})}\n\n"

        # 发送完成消息（conversation_id 若未传入则自动生成，保证前端可持久化历史）
        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation_id or str(uuid.uuid4())})}\n\n"

    finally:
        await llm.close()


@router.post("")
async def chat(project_id: str, chat_msg: ChatMessage):
    """对话接口（流式响应，支持Function Calling和Agentic Loop）"""
    return StreamingResponse(
        stream_conversation(project_id, chat_msg.message, chat_msg.conversation_id, chat_msg.episode_id, chat_msg.context_messages),
        media_type="text/event-stream"
    )




@router.get("/debug-prompt")
async def debug_prompt(project_id: str, episode_id: Optional[str] = None, tab_name: Optional[str] = None):
    """
    调试接口：直接调用与 stream_conversation 完全相同的 _build_system_prompt，
    保证展示内容与 AI 实际收到的 system_prompt 完全一致。
    """
    from app.services import ProjectService
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ai_config = project.get("ai_config", {})
    system_prompt, tools_desc = _build_system_prompt(project, ai_config, episode_id)
    return {"system_prompt": system_prompt, "tools_desc": tools_desc}
