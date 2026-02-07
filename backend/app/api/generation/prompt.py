"""
Generation API - 提示词模板管理端点
"""

from fastapi import APIRouter, HTTPException

from app.services import PromptService
from .models import PromptTemplateUpdate
from .templates import DEFAULT_PROMPT_TEMPLATES

router = APIRouter()


@router.get("/prompt-templates")
async def get_prompt_templates(project_id: str):
    """获取项目的提示词模板"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 从项目配置中获取自定义模板，如果没有则使用默认值
    custom_templates = project.get("ai_config", {}).get("prompt_templates", {})

    # 如果没有自定义模板，使用 PromptService 中的默认模板
    if not custom_templates.get("storyboard_generation_prompt_template"):
        custom_templates["storyboard_generation_prompt_template"] = PromptService.STORYBOARD_DESC_TEMPLATE
    if not custom_templates.get("storyboard_image_prompt_template"):
        # 为分镜图片生成创建默认模板
        custom_templates["storyboard_image_prompt_template"] = """你是一位世界顶级的AI绘画专家，专精于将分镜描述转换为高质量的绘画提示词。

【分镜信息】
分镜描述：{description}
镜头类型：{shot_type}
动作要求：{action}
镜头角度：{camera_angle}

【提示词生成要求】
1. **精确还原**：
   - 完全遵循分镜的所有构图要求
   - 准确呈现角色动作和表情
   - 精确还原场景和道具细节

2. **艺术质量**：
   - 使用专业构图术语
   - 强调光影和色彩表现
   - 添加适当的细节描述

3. **风格匹配**：
   - 根据镜头类型选择合适的艺术风格
   - 保持画风的一致性

【输出格式】
返回JSON格式：
{{
  "positive_prompt": "完整的英文正向提示词",
  "negative_prompt": "完整的英文负向提示词"
}}"""

    return {
        "image_prompt_template": custom_templates.get("image_prompt_template", DEFAULT_PROMPT_TEMPLATES["image_prompt_template"]),
        "video_prompt_template": custom_templates.get("video_prompt_template", DEFAULT_PROMPT_TEMPLATES["video_prompt_template"]),
        "video_reverse_prompt_template": custom_templates.get("video_reverse_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("video_reverse_prompt_template", "")),
        "storyboard_generation_prompt_template": custom_templates.get("storyboard_generation_prompt_template", PromptService.STORYBOARD_DESC_TEMPLATE),
        "storyboard_image_prompt_template": custom_templates.get("storyboard_image_prompt_template", custom_templates.get("storyboard_image_prompt_template") or DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_prompt_template", "")),
        "storyboard_image_edit_prompt_template": custom_templates.get("storyboard_image_edit_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_edit_prompt_template", "")),
        "image_edit_prompt_template": custom_templates.get("image_edit_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("image_edit_prompt_template", "")),
        "triple_grid_prompt_template": custom_templates.get("triple_grid_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("triple_grid_prompt_template", "")),
        "vlm_prompt_template": custom_templates.get("vlm_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("vlm_prompt_template", "")),
        "is_custom": bool(custom_templates)
    }


@router.put("/prompt-templates")
async def update_prompt_templates(project_id: str, templates: PromptTemplateUpdate):
    """更新项目的提示词模板"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 更新项目的提示词模板
    ai_config = project.get("ai_config", {})
    prompt_templates = ai_config.get("prompt_templates", {})

    if templates.image_prompt_template is not None:
        prompt_templates["image_prompt_template"] = templates.image_prompt_template
    if templates.video_prompt_template is not None:
        prompt_templates["video_prompt_template"] = templates.video_prompt_template
    if templates.video_reverse_prompt_template is not None:
        prompt_templates["video_reverse_prompt_template"] = templates.video_reverse_prompt_template
    if templates.storyboard_generation_prompt_template is not None:
        prompt_templates["storyboard_generation_prompt_template"] = templates.storyboard_generation_prompt_template
    if templates.storyboard_image_prompt_template is not None:
        prompt_templates["storyboard_image_prompt_template"] = templates.storyboard_image_prompt_template
    if templates.storyboard_image_edit_prompt_template is not None:
        prompt_templates["storyboard_image_edit_prompt_template"] = templates.storyboard_image_edit_prompt_template
    if templates.image_edit_prompt_template is not None:
        prompt_templates["image_edit_prompt_template"] = templates.image_edit_prompt_template
    if templates.triple_grid_prompt_template is not None:
        prompt_templates["triple_grid_prompt_template"] = templates.triple_grid_prompt_template
    if templates.vlm_prompt_template is not None:
        prompt_templates["vlm_prompt_template"] = templates.vlm_prompt_template

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
