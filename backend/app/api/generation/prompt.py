"""
Generation API - 提示词模板管理端点（方案B：类别多模板）
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from app.services import PromptService
from .models import PromptTemplateUpdate
from .templates import DEFAULT_PROMPT_TEMPLATES, DEFAULT_PRESETS, TEMPLATE_TYPES, OLD_TO_NEW_TEMPLATE_MAPPING

router = APIRouter()


@router.get("/prompt-templates")
async def get_prompt_templates(project_id: str):
    """
    获取项目的提示词模板（方案B：结构化返回）

    返回格式：
    {
        "image": {
            "presets": {"default": {...}, "nine_grid": {...}},
            "custom": {"custom_1": {...}},
            "active": "default",
            "templates": {...}  // 合并后的所有模板
        },
        ...
    }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    custom_templates_config = ai_config.get("prompt_templates", {})

    # 检测是否为旧格式（扁平化的字符串）
    is_old_format = False
    if custom_templates_config:
        # 如果第一个值是字符串，说明是旧格式
        first_value = next(iter(custom_templates_config.values()), None)
        if isinstance(first_value, str):
            is_old_format = True

    # 构建返回结果
    result = {}

    for template_type in TEMPLATE_TYPES:
        # 获取预设模板
        presets = DEFAULT_PRESETS.get(template_type, {})

        if is_old_format:
            # 旧格式：简单包装
            old_key = OLD_TO_NEW_TEMPLATE_MAPPING.get(f"{template_type}_prompt_template") or f"{template_type}_prompt_template"
            # 反向查找旧key
            old_key_found = None
            for old_k, new_t in OLD_TO_NEW_TEMPLATE_MAPPING.items():
                if new_t == template_type:
                    old_key_found = old_k
                    break

            old_content = custom_templates_config.get(old_key_found) if old_key_found else None

            if old_content:
                # 有自定义内容 → 包装为 custom["legacy"]
                custom = {
                    "legacy": {
                        "name": "当前自定义",
                        "description": "旧版本的自定义模板",
                        "content": old_content,
                        "is_preset": False
                    }
                }
                active = "legacy"
            else:
                # 无自定义 → 使用default预设
                custom = {}
                active = "default"
        else:
            # 新格式：直接读取
            type_data = custom_templates_config.get(template_type, {})
            custom = type_data.get("custom", {}) if isinstance(type_data, dict) else {}
            active = type_data.get("active", "default") if isinstance(type_data, dict) else "default"

        # 合并所有模板
        all_templates = {}

        # 添加预设模板
        for preset_id, preset_data in presets.items():
            all_templates[preset_id] = {
                **preset_data,
                "is_preset": True
            }

        # 添加自定义模板
        for custom_id, custom_data in custom.items():
            all_templates[custom_id] = {
                **custom_data,
                "is_preset": False
            }

        result[template_type] = {
            "presets": presets,
            "custom": custom,
            "active": active,
            "templates": all_templates
        }

    # 添加兼容字段（用于前端判断是否为自定义）
    result["is_custom"] = bool(custom_templates_config)
    result["is_legacy"] = is_old_format

    return result


@router.put("/prompt-templates")
async def update_prompt_templates(project_id: str, templates: Dict[str, Any]):
    """
    更新项目的提示词模板（方案B：结构化更新）

    接收格式：
    {
        "image": {
            "custom": {"custom_1": {...}},
            "active": "custom_1"
        },
        "video": {
            "active": "nine_grid"
        },
        ...
    }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 获取现有配置
    ai_config = project.get("ai_config", {})
    prompt_templates = ai_config.get("prompt_templates", {})

    # 检测旧格式并清理（迁移时删除旧key）
    is_old_format = False
    if prompt_templates:
        first_value = next(iter(prompt_templates.values()), None)
        if isinstance(first_value, str):
            is_old_format = True

    if is_old_format:
        # 清空旧格式数据，准备保存新格式
        prompt_templates = {}

    # 更新提供的模板类型
    for template_type, type_data in templates.items():
        # 跳过非模板类型的字段
        if template_type not in TEMPLATE_TYPES:
            continue

        # 初始化结构（如果不存在）
        if template_type not in prompt_templates:
            prompt_templates[template_type] = {
                "custom": {},
                "active": "default"
            }

        # 更新字段（注意：不保存 presets 和 templates，它们由代码提供）
        if "custom" in type_data:
            prompt_templates[template_type]["custom"] = type_data["custom"]

        if "active" in type_data:
            prompt_templates[template_type]["active"] = type_data["active"]

    ai_config["prompt_templates"] = prompt_templates

    # 保存项目
    ProjectService.update_project(project_id, ai_config=ai_config)

    return {"success": True, "message": "提示词模板已更新"}


@router.post("/prompt-templates/reset")
async def reset_prompt_templates(project_id: str):
    """重置为默认提示词模板"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 清除自定义模板，恢复默认值
    ai_config = project.get("ai_config", {})
    ai_config["prompt_templates"] = {}

    ProjectService.update_project(project_id, ai_config=ai_config)

    return {"success": True, "message": "已恢复默认提示词模板"}


# ==================== 向后兼容：旧接口（Deprecated） ====================
# 保留旧的扁平化接口，供旧代码调用，标记为废弃

@router.get("/prompt-templates-legacy")
async def get_prompt_templates_legacy(project_id: str):
    """
    获取项目的提示词模板（旧接口，已废弃）
    保留用于向后兼容
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    custom_templates = project.get("ai_config", {}).get("prompt_templates", {})

    # 如果没有自定义模板，使用 PromptService 中的默认模板
    if not custom_templates.get("storyboard_generation_prompt_template"):
        custom_templates["storyboard_generation_prompt_template"] = PromptService.STORYBOARD_DESC_TEMPLATE

    return {
        "image_prompt_template": custom_templates.get("image_prompt_template", DEFAULT_PROMPT_TEMPLATES["image_prompt_template"]),
        "video_prompt_template": custom_templates.get("video_prompt_template", DEFAULT_PROMPT_TEMPLATES["video_prompt_template"]),
        "video_reverse_prompt_template": custom_templates.get("video_reverse_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("video_reverse_prompt_template", "")),
        "storyboard_generation_prompt_template": custom_templates.get("storyboard_generation_prompt_template", PromptService.STORYBOARD_DESC_TEMPLATE),
        "storyboard_image_prompt_template": custom_templates.get("storyboard_image_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_prompt_template", "")),
        "storyboard_image_edit_prompt_template": custom_templates.get("storyboard_image_edit_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_edit_prompt_template", "")),
        "image_edit_prompt_template": custom_templates.get("image_edit_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("image_edit_prompt_template", "")),
        "triple_grid_prompt_template": custom_templates.get("triple_grid_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("triple_grid_prompt_template", "")),
        "vlm_prompt_template": custom_templates.get("vlm_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("vlm_prompt_template", "")),
        "multi_scene_video_prompt": custom_templates.get("multi_scene_video_prompt", DEFAULT_PROMPT_TEMPLATES.get("multi_scene_video_prompt", "")),
        "is_custom": bool(custom_templates)
    }
