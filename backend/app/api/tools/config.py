"""配置工具执行逻辑"""
import time
from datetime import datetime
from typing import Dict
from app.services import AssetService
from app.models.project import normalize_global_style_config
from .helpers import _resolve_episode_id, KEY_ALIASES


async def handle_update_project_config(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        if not proj:
            return {"success": False, "error": "项目不存在"}
        path = parameters.get("path", "")
        value = parameters.get("value")
        ALLOWED_PATHS = {"video_style.custom_suffix", "image_style.custom_suffix", "global_style", "prompt_language"}
        if path not in ALLOWED_PATHS:
            return {"success": False, "error": f"不允许修改路径 '{path}'，只允许：{', '.join(sorted(ALLOWED_PATHS))}"}
        ai_cfg = proj.get("ai_config", {})
        global_style = normalize_global_style_config(ai_cfg.get("global_style_config"))

        def _apply_style(style_key: str, val: str):
            style_cfg = global_style.get(style_key, {})
            custom_presets = style_cfg.get("custom_presets", [])
            AI_PRESET_NAME = "AI设计风格"
            ai_preset = next((p for p in custom_presets if p.get("name") == AI_PRESET_NAME), None)
            if ai_preset:
                ai_preset["content"] = val
                preset_id_val = ai_preset["id"]
            else:
                preset_id_val = f"custom_ai_{int(time.time() * 1000)}"
                custom_presets.append({"id": preset_id_val, "name": AI_PRESET_NAME, "content": val})
            style_cfg["custom_presets"] = custom_presets
            style_cfg["active_custom_id"] = preset_id_val
            style_cfg["preset_id"] = "custom"
            style_cfg["custom_suffix"] = val
            global_style[style_key] = style_cfg

        if path == "global_style":
            _apply_style("video_style", value)
            _apply_style("image_style", value)
        elif path in ("video_style.custom_suffix", "image_style.custom_suffix"):
            _apply_style(path.split(".")[0], value)
        else:
            global_style[path] = value

        ai_cfg["global_style_config"] = global_style
        ProjectService.update_project(project_id, ai_config=ai_cfg)
        return {"success": True, "path": path, "new_value": value}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_update_ai_instructions(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        if not proj:
            return {"success": False, "error": "项目不存在"}
        content = parameters.get("content", "")
        mode = parameters.get("mode", "replace")
        if mode == "append":
            existing = proj.get("ai_instructions", "").strip()
            new_instructions = (existing + "\n\n" + content).strip() if existing else content
        else:
            new_instructions = content
        from app.models.project import Project
        _proj_obj = Project.load(project_id)
        _proj_obj.ai_instructions = new_instructions
        _proj_obj.save_metadata()
        return {"success": True, "mode": mode, "length": len(new_instructions)}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_update_prompt_template(project_id: str, parameters: Dict) -> Dict:
    try:
        SYSTEM_TEMPLATE_BLACKLIST = {
            "conversation_tools_desc", "conversation_tools_desc_assets",
            "conversation_system_prompt", "script_analysis_system_prompt", "script_parse",
        }

        def _to_bool(value, default=False):
            if isinstance(value, bool):
                return value
            if value is None:
                return default
            return str(value).strip().lower() in {"1", "true", "yes", "y"}

        def _replace_nth(text: str, old: str, new: str, occurrence: int) -> str:
            start = -1
            index = 0
            for _ in range(occurrence):
                start = text.find(old, index)
                if start < 0:
                    return text
                index = start + len(old)
            return text[:start] + new + text[start + len(old):]

        def _normalize_punctuation(text: str) -> str:
            import re
            text = re.sub(r"，\s*，+", "，", text)
            text = re.sub(r",\s*,+", ",", text)
            text = re.sub(r"，\s*。", "。", text)
            text = re.sub(r",\s*\.", ".", text)
            text = re.sub(r"\s+，", "，", text)
            text = re.sub(r"\s+,", ",", text)
            return text

        key = KEY_ALIASES.get(parameters.get("key", ""), parameters.get("key", ""))
        if key in SYSTEM_TEMPLATE_BLACKLIST:
            return {"success": False, "error": f"禁止修改系统模板 '{key}'，只允许修改生成模板（image/video/storyboard等）"}

        from app.services import ProjectService
        from app.services.global_prompt_service import get_prompt_content, load_prompts as _load_prompts

        proj = ProjectService.get_project(project_id)
        if not proj:
            return {"success": False, "error": "项目不存在"}

        ai_cfg = proj.get("ai_config", {})
        mode = (parameters.get("mode") or "patch").strip().lower()
        if mode not in {"patch", "replace"}:
            return {"success": False, "error": "mode 只支持 patch 或 replace"}

        existing_content = get_prompt_content(key, ai_cfg)
        if not existing_content:
            return {"success": False, "error": f"模板不存在或无可编辑内容: {key}"}

        match_count = None
        match_counts = []
        applied_edits = 0
        operation = None
        if mode == "patch":
            edits = parameters.get("edits")

            def _coerce_str(v) -> str:
                if v is None:
                    return ""
                return v if isinstance(v, str) else str(v)

            def _coerce_occurrence(v) -> int:
                try:
                    return max(1, int(v))
                except Exception:
                    return 1

            def _apply_replace_step(text: str, step: Dict, index: int):
                old_string = _coerce_str(step.get("old_string", ""))
                if not old_string:
                    return None, f"edits[{index}] 的 old_string 不能为空", None

                new_string = _coerce_str(step.get("new_string", ""))
                replace_all = _to_bool(step.get("replace_all", False), False)
                occurrence = _coerce_occurrence(step.get("occurrence", 1))

                count = text.count(old_string)
                if count == 0:
                    return None, f"edits[{index}] old_string 未找到", None

                if replace_all:
                    updated = text.replace(old_string, new_string)
                else:
                    if count > 1 and occurrence == 1:
                        return None, f"edits[{index}] 命中多处，请指定 occurrence 或提供更精确片段", None
                    if occurrence > count:
                        return None, f"edits[{index}] occurrence 超出命中次数（仅命中 {count} 处）", None
                    updated = _replace_nth(text, old_string, new_string, occurrence)

                return updated, None, count

            if isinstance(edits, list) and edits:
                operation = "batch_replace"
                content = existing_content
                for idx, step in enumerate(edits, start=1):
                    if not isinstance(step, dict):
                        return {"success": False, "error": f"edits[{idx}] 必须是对象"}
                    updated, err, count = _apply_replace_step(content, step, idx)
                    if err:
                        return {"success": False, "error": err}
                    content = updated
                    match_counts.append(count)
                    applied_edits += 1
                match_count = sum(match_counts)
            else:
                operation = (parameters.get("operation") or "replace_text").strip().lower()
                if operation not in {"replace_text", "delete_text", "insert_after_anchor", "insert_before_anchor"}:
                    return {"success": False, "error": "patch 模式下 operation 只支持 replace_text/delete_text/insert_after_anchor/insert_before_anchor"}

                old_string = _coerce_str(parameters.get("old_string", ""))
                new_string = _coerce_str(parameters.get("new_string", ""))
                replace_all = _to_bool(parameters.get("replace_all", False), False)
                occurrence = _coerce_occurrence(parameters.get("occurrence", 1))

                if operation in {"replace_text", "delete_text"}:
                    if not old_string:
                        return {"success": False, "error": f"{operation} 操作要求 old_string 不能为空"}
                    replacement = "" if operation == "delete_text" else new_string
                    match_count = existing_content.count(old_string)
                    if match_count == 0:
                        return {"success": False, "error": "old_string 未找到，请先读取模板并提供更精确片段"}
                    if replace_all:
                        content = existing_content.replace(old_string, replacement)
                    else:
                        if match_count > 1 and occurrence == 1:
                            return {"success": False, "error": "old_string 命中多处，请提供更长上下文或指定 occurrence"}
                        if occurrence > match_count:
                            return {"success": False, "error": f"occurrence 超出命中次数（仅命中 {match_count} 处）"}
                        content = _replace_nth(existing_content, old_string, replacement, occurrence)
                else:
                    anchor = _coerce_str(parameters.get("anchor", ""))
                    if not anchor:
                        anchor = old_string
                    if not anchor:
                        return {"success": False, "error": f"{operation} 操作要求 anchor（或 old_string）不能为空"}

                    anchor_count = existing_content.count(anchor)
                    if anchor_count == 0:
                        return {"success": False, "error": "anchor 未找到，请先读取模板并提供更精确锚点"}
                    if anchor_count > 1:
                        return {"success": False, "error": "anchor 命中多处，请提供更长且唯一的锚点"}

                    idx = existing_content.find(anchor)
                    if operation == "insert_after_anchor":
                        insert_at = idx + len(anchor)
                    else:
                        insert_at = idx
                    content = existing_content[:insert_at] + new_string + existing_content[insert_at:]
                    match_count = anchor_count
                applied_edits = 1

            if _to_bool(parameters.get("normalize_punctuation", True), True):
                content = _normalize_punctuation(content)
        else:
            content = parameters.get("content", "")
            if not isinstance(content, str) or not content.strip():
                return {"success": False, "error": "replace 模式下 content 不能为空"}
            applied_edits = 1

        _prompts = _load_prompts()
        presets = _prompts.get(key, {}).get("presets", {})
        default_preset = presets.get("default") or presets.get("default_ai") or (next(iter(presets.values())) if presets else {})
        declared_vars = default_preset.get("variables", []) if isinstance(default_preset, dict) else []
        missing_vars = [v for v in declared_vars if v not in content]
        if missing_vars:
            content = "\n".join(missing_vars) + "\n\n" + content

        overrides = ai_cfg.get("prompt_overrides", {})
        if key not in overrides:
            overrides[key] = {}
        custom = overrides[key].get("custom", {})
        AI_TEMPLATE_NAME = "AI自定义"
        existing_id = next((k for k, v in custom.items() if v.get("name") == AI_TEMPLATE_NAME), None)
        if existing_id:
            custom[existing_id]["content"] = content
            active_id = existing_id
        else:
            active_id = f"custom_ai_{int(time.time() * 1000)}"
            custom[active_id] = {"name": AI_TEMPLATE_NAME, "description": "由小龙虾 AI 自动创建", "content": content, "is_preset": False}

        overrides[key]["custom"] = custom
        overrides[key]["active"] = active_id
        overrides[key].pop("custom_suffix", None)
        ai_cfg["prompt_overrides"] = overrides
        ProjectService.update_project(project_id, ai_config=ai_cfg)

        result = {
            "success": True,
            "key": key,
            "mode": mode,
            "operation": operation,
            "template_id": active_id,
            "content_length": len(content),
            "applied_edits": applied_edits,
            "notice": f"⚠️ 格式规范已更新。请从现在起立即采用以下新规范，替代你记忆中的旧格式：\n\n{content}",
        }
        if match_count is not None:
            result["match_count"] = match_count
        if match_counts:
            result["match_counts"] = match_counts
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_update_episode_script(project_id: str, parameters: Dict) -> Dict:
    try:
        ep_id, err = _resolve_episode_id(project_id, parameters.get("episode_id", ""))
        if err:
            return {"success": False, "error": err}
        episode = AssetService.load_asset(project_id, "episode", ep_id)
        if not episode:
            return {"success": False, "error": f"剧集不存在: {ep_id}"}
        script = parameters.get("script", "")
        mode = parameters.get("mode", "replace")
        if mode == "append":
            existing = episode.get("script_content", episode.get("script", "")).strip()
            episode["script_content"] = (existing + "\n\n" + script).strip() if existing else script
        else:
            episode["script_content"] = script
        episode["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "episode", episode)
        return {"success": True, "episode_id": ep_id, "mode": mode}
    except Exception as e:
        return {"success": False, "error": str(e)}
