"""
Generation API - 提示词模板辅助常量

所有提示词内容存储在 data/config/default_prompt_templates.json。
此文件只保留：
  - TEMPLATE_TYPES：从 JSON 动态读取（向后兼容用）
  - OLD_TO_NEW_TEMPLATE_MAPPING：旧格式迁移用
  - DEFAULT_PRESETS / DEFAULT_PROMPT_TEMPLATES：向后兼容的空占位，实际内容从 JSON 读取
"""
from typing import Dict, Any


def _get_template_types() -> list:
    """从 JSON 动态读取所有生成模板的 key 列表"""
    try:
        from app.services.global_prompt_service import get_group_a_presets
        keys = list(get_group_a_presets().keys())
        return keys if keys else _FALLBACK_TEMPLATE_TYPES
    except Exception:
        return _FALLBACK_TEMPLATE_TYPES


def _get_default_presets() -> Dict[str, Any]:
    """从 JSON 动态读取所有生成模板预设"""
    try:
        from app.services.global_prompt_service import get_group_a_presets
        presets = get_group_a_presets()
        return presets if presets else {}
    except Exception:
        return {}


# 静态回退列表（仅在 JSON 无法读取时使用）
_FALLBACK_TEMPLATE_TYPES = [
    "image", "video", "video_reverse", "storyboard",
    "storyboard_image", "storyboard_image_edit", "image_edit", "character_sheet",
    "triple_grid", "vlm", "multi_scene_video", "nine_grid_combined_prompts",
]

# 向后兼容导出（动态读取）
TEMPLATE_TYPES: list = _get_template_types()
DEFAULT_PRESETS: Dict[str, Any] = _get_default_presets()

# 旧格式：扁平化模板（向后兼容，内容从预设中提取）
DEFAULT_PROMPT_TEMPLATES: Dict[str, str] = {
    key: presets.get("default", {}).get("content", "")
    for key, presets in DEFAULT_PRESETS.items()
}

# 旧模板类型到新类型的映射（用于旧项目数据迁移）
OLD_TO_NEW_TEMPLATE_MAPPING = {
    "image_prompt_template": "image",
    "video_prompt_template": "video",
    "video_reverse_prompt_template": "video_reverse",
    "storyboard_generation_prompt_template": "storyboard",
    "storyboard_image_prompt_template": "storyboard_image",
    "storyboard_image_edit_prompt_template": "storyboard_image_edit",
    "image_edit_prompt_template": "image_edit",
    "triple_grid_prompt_template": "triple_grid",
    "vlm_prompt_template": "vlm",
    "multi_scene_video_prompt": "multi_scene_video",
}
