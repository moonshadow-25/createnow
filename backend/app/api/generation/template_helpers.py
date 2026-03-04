"""
Generation API - 模板辅助函数
获取当前激活的模板内容（支持项目级覆盖）
"""
from typing import Optional


def get_active_template(ai_config: dict, template_type: str) -> str:
    """
    获取当前激活的模板内容。

    优先级：项目自定义 > 项目激活预设 > 全局 JSON default 预设

    Args:
        ai_config: 项目的 AI 配置
        template_type: 模板类型 key（如 "image", "video", "nine_grid_combined_prompts"）

    Returns:
        模板内容字符串
    """
    from app.services.global_prompt_service import get_prompt_content, load_prompts

    prompt_templates = ai_config.get("prompt_templates", {})

    # ── 检查新格式（prompt_overrides）──────────────────────────────────────────
    overrides = ai_config.get("prompt_overrides", {})
    override = overrides.get(template_type)
    if isinstance(override, dict):
        active = override.get("active", "default")
        custom = override.get("custom", {})
        if active in custom:
            return custom[active].get("content", "")
        # 激活的是某个全局 preset
        prompts = load_prompts()
        presets = prompts.get(template_type, {}).get("presets", {})
        if active in presets:
            return presets[active].get("content", "")
        return get_prompt_content(template_type)

    # ── 兼容旧格式（prompt_templates）──────────────────────────────────────────
    type_data = prompt_templates.get(template_type, {})
    if isinstance(type_data, dict) and "active" in type_data:
        # 新结构但在旧字段名下
        active_id = type_data.get("active", "default")
        custom_templates = type_data.get("custom", {})
        if active_id in custom_templates:
            return custom_templates[active_id].get("content", "")
        prompts = load_prompts()
        presets = prompts.get(template_type, {}).get("presets", {})
        if active_id in presets:
            return presets[active_id].get("content", "")
    elif isinstance(type_data, str) and type_data:
        # 最旧格式：扁平字符串
        return type_data
    else:
        # 检查旧 key 名称（如 image_prompt_template）
        from .templates import OLD_TO_NEW_TEMPLATE_MAPPING
        for old_key, new_type in OLD_TO_NEW_TEMPLATE_MAPPING.items():
            if new_type == template_type and old_key in prompt_templates:
                val = prompt_templates[old_key]
                if isinstance(val, str) and val:
                    return val

    # 全局默认
    return get_prompt_content(template_type)


def get_template_by_id(ai_config: dict, template_type: str, template_id: str) -> Optional[str]:
    """
    根据模板 ID 获取模板内容

    Args:
        ai_config: 项目的 AI 配置
        template_type: 模板类型
        template_id: 模板 ID

    Returns:
        模板内容字符串，如果不存在则返回 None
    """
    from app.services.global_prompt_service import load_prompts

    # 先找自定义（新旧字段名都检查）
    for field in ("prompt_overrides", "prompt_templates"):
        type_data = ai_config.get(field, {}).get(template_type)
        if isinstance(type_data, dict):
            custom = type_data.get("custom", {})
            if template_id in custom:
                return custom[template_id].get("content")

    # 再找预设
    prompts = load_prompts()
    presets = prompts.get(template_type, {}).get("presets", {})
    if template_id in presets:
        return presets[template_id].get("content")

    return None
