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
        key = KEY_ALIASES.get(parameters.get("key", ""), parameters.get("key", ""))
        if key in SYSTEM_TEMPLATE_BLACKLIST:
            return {"success": False, "error": f"禁止修改系统模板 '{key}'，只允许修改生成模板（image/video/storyboard等）"}
        content = parameters.get("content", "")
        if not content.strip():
            return {"success": False, "error": "content 不能为空"}
        from app.services.global_prompt_service import load_prompts as _load_prompts
        _prompts = _load_prompts()
        declared_vars = _prompts.get(key, {}).get("presets", {}).get("default", {}).get("variables", [])
        missing_vars = [v for v in declared_vars if v not in content]
        if missing_vars:
            content = "\n".join(missing_vars) + "\n\n" + content
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        if not proj:
            return {"success": False, "error": "项目不存在"}
        ai_cfg = proj.get("ai_config", {})
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
        return {"success": True, "key": key, "template_id": active_id, "content_length": len(content),
                "notice": f"⚠️ 格式规范已更新。请从现在起立即采用以下新规范，替代你记忆中的旧格式：\n\n{content}"}
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
