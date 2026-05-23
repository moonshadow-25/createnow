"""
Generation API - 项目级提示词模板管理端点

支持对所有全局提示词（生成模板/服务提示词/系统提示词）的项目级覆盖。
项目覆盖存储在 ai_config.prompt_overrides 中（新字段名）。
旧字段 ai_config.prompt_templates 保持只读向后兼容。
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from app.services.global_prompt_service import load_prompts
from .templates import OLD_TO_NEW_TEMPLATE_MAPPING

router = APIRouter()

# 这些模板是 AI agent 工具调用 schema，是底层脚手架，不开放给用户自定义。
# 用户覆盖这些模板会破坏 AI 工具调用机制。
# 注意：全局提示词管理接口（GlobalPromptPanel）仍保持对这些 key 的完整访问。
_HIDDEN_KEYS = {
    "conversation_tools_desc",
}


@router.get("/prompt-templates")
async def get_prompt_templates(project_id: str):
    """
    获取项目的提示词模板。

    返回格式：
    {
        "<key>": {
            "label": "资产图片",
            "category": "生成模板",
            "presets": {"default": {...}, "nine_grid": {...}},
            "custom": {"custom_1": {...}},
            "active": "default",
            "templates": {...}   // presets + custom 合并
        },
        ...
    }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 读取项目覆盖（新字段优先，回退旧字段）
    overrides = ai_config.get("prompt_overrides", {})
    legacy_templates = ai_config.get("prompt_templates", {})

    # 检测旧格式（扁平字符串）
    is_old_format = False
    if legacy_templates:
        first_value = next(iter(legacy_templates.values()), None)
        if isinstance(first_value, str):
            is_old_format = True

    # 加载全局提示词
    all_prompts = load_prompts()
    result = {}

    for key, prompt_data in all_prompts.items():
        if key in _HIDDEN_KEYS:
            continue
        presets = prompt_data.get("presets", {})

        # 确定 custom 和 active
        custom = {}
        active = "default"

        if key in overrides and isinstance(overrides[key], dict):
            # 新格式覆盖
            custom = overrides[key].get("custom", {})
            active = overrides[key].get("active", "default")
        elif not is_old_format and key in legacy_templates and isinstance(legacy_templates.get(key), dict):
            # 旧字段但新结构（过渡期兼容）
            type_data = legacy_templates[key]
            custom = type_data.get("custom", {})
            active = type_data.get("active", "default")

        # 兜底：若 active 指向的 preset/custom 不存在，改用 default_ai（若存在）
        all_available = {**presets, **custom}
        if active not in all_available and "default_ai" in presets:
            active = "default_ai"
        elif is_old_format:
            # 旧格式：查找对应旧 key
            old_key = None
            for ok, nk in OLD_TO_NEW_TEMPLATE_MAPPING.items():
                if nk == key:
                    old_key = ok
                    break
            old_content = legacy_templates.get(old_key) if old_key else None
            if old_content and isinstance(old_content, str):
                custom = {"legacy": {
                    "name": "当前自定义",
                    "description": "旧版本的自定义模板",
                    "content": old_content,
                    "is_preset": False,
                }}
                active = "legacy"

        # 合并所有模板（预设 + 自定义）
        all_templates = {}
        for pid, pdata in presets.items():
            all_templates[pid] = {**pdata, "is_preset": True}
        for cid, cdata in custom.items():
            all_templates[cid] = {**cdata, "is_preset": False}

        # 兜底：active 指向不存在的 preset/custom 时，优先用 default_ai，再用 default
        if active not in all_templates:
            if "default_ai" in all_templates:
                active = "default_ai"
            elif "default" in all_templates:
                active = "default"

        result[key] = {
            "label": prompt_data.get("label", key),
            "category": prompt_data.get("category", ""),
            "presets": presets,
            "custom": custom,
            "active": active,
            "templates": all_templates,
        }

    result["is_custom"] = bool(overrides or (not is_old_format and legacy_templates))
    result["is_legacy"] = is_old_format

    return result


@router.put("/prompt-templates")
async def update_prompt_templates(project_id: str, templates: Dict[str, Any]):
    """
    更新项目的提示词模板（保存到 prompt_overrides）。

    接收格式：
    {
        "image": { "active": "custom_1", "custom": {"custom_1": {...}} },
        "character_analysis": { "active": "default" },
        ...
    }
    接受任意合法的提示词 key。
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    prompt_overrides = ai_config.get("prompt_overrides", {})

    # 迁移旧格式 prompt_templates → prompt_overrides（一次性）
    legacy = ai_config.get("prompt_templates", {})
    if legacy:
        first_val = next(iter(legacy.values()), None)
        if isinstance(first_val, str):
            # 旧扁平格式：丢弃（用户切换后自然覆盖）
            pass
        else:
            # 旧结构格式：迁移
            for k, v in legacy.items():
                if isinstance(v, dict) and k not in prompt_overrides:
                    prompt_overrides[k] = v
        ai_config["prompt_templates"] = {}  # 清空旧字段

    # 加载合法 key 集合
    valid_keys = set(load_prompts().keys())

    for key, type_data in templates.items():
        if key in _HIDDEN_KEYS:
            continue   # 拒绝写入工具 schema 类隐藏 key
        if key not in valid_keys:
            continue
        if not isinstance(type_data, dict):
            continue

        if key not in prompt_overrides:
            prompt_overrides[key] = {"custom": {}, "active": "default"}

        if "custom" in type_data:
            prompt_overrides[key]["custom"] = type_data["custom"]
        if "active" in type_data:
            prompt_overrides[key]["active"] = type_data["active"]

    ai_config["prompt_overrides"] = prompt_overrides
    ProjectService.update_project(project_id, ai_config=ai_config)

    return {"success": True, "message": "提示词模板已更新"}


@router.post("/prompt-templates/reset")
async def reset_prompt_templates(project_id: str):
    """清除所有项目级覆盖，恢复使用全局默认"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    ai_config["prompt_overrides"] = {}
    ai_config["prompt_templates"] = {}  # 同时清除旧字段

    ProjectService.update_project(project_id, ai_config=ai_config)
    return {"success": True, "message": "已恢复默认提示词模板"}
