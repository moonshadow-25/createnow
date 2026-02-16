"""
Generation API - 模板辅助函数
用于读取当前激活的模板
"""

from typing import Optional
from .templates import DEFAULT_PRESETS, DEFAULT_PROMPT_TEMPLATES


def get_active_template(ai_config: dict, template_type: str) -> str:
    """
    获取当前激活的模板内容

    Args:
        ai_config: 项目的AI配置
        template_type: 模板类型（image, video, storyboard等）

    Returns:
        模板内容字符串
    """
    prompt_templates = ai_config.get("prompt_templates", {})

    # 检查是否为新格式（结构化）
    type_data = prompt_templates.get(template_type, {})

    if isinstance(type_data, dict) and "active" in type_data:
        # 新格式：结构化数据
        active_id = type_data.get("active", "default")

        # 先找自定义模板
        custom_templates = type_data.get("custom", {})
        if active_id in custom_templates:
            return custom_templates[active_id].get("content", "")

        # 再找预设模板
        presets = DEFAULT_PRESETS.get(template_type, {})
        if active_id in presets:
            return presets[active_id].get("content", "")

        # 如果都没找到，返回default预设
        default_preset = presets.get("default", {})
        return default_preset.get("content", "")

    else:
        # 旧格式：扁平化字符串
        # 尝试从旧的key中读取
        old_key_mapping = {
            "image": "image_prompt_template",
            "video": "video_prompt_template",
            "video_reverse": "video_reverse_prompt_template",
            "storyboard": "storyboard_generation_prompt_template",
            "storyboard_image": "storyboard_image_prompt_template",
            "storyboard_image_edit": "storyboard_image_edit_prompt_template",
            "image_edit": "image_edit_prompt_template",
            "triple_grid": "triple_grid_prompt_template",
            "vlm": "vlm_prompt_template",
            "multi_scene_video": "multi_scene_video_prompt",
        }

        old_key = old_key_mapping.get(template_type)
        if old_key and old_key in prompt_templates:
            return prompt_templates[old_key]

        # 最后回退到默认模板
        return DEFAULT_PROMPT_TEMPLATES.get(old_key, "")


def get_template_by_id(ai_config: dict, template_type: str, template_id: str) -> Optional[str]:
    """
    根据模板ID获取模板内容

    Args:
        ai_config: 项目的AI配置
        template_type: 模板类型
        template_id: 模板ID

    Returns:
        模板内容字符串，如果不存在则返回None
    """
    prompt_templates = ai_config.get("prompt_templates", {})
    type_data = prompt_templates.get(template_type, {})

    if not isinstance(type_data, dict):
        return None

    # 先找自定义
    custom_templates = type_data.get("custom", {})
    if template_id in custom_templates:
        return custom_templates[template_id].get("content")

    # 再找预设
    presets = DEFAULT_PRESETS.get(template_type, {})
    if template_id in presets:
        return presets[template_id].get("content")

    return None
