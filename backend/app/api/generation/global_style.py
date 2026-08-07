"""
全局风格配置管理API

提供全局风格配置的CRUD操作，包括：
- 语言设置
- 图片风格预设
- 视频风格预设
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from .models import GlobalStyleConfig, GlobalStyleConfigUpdate
from .style_presets import get_all_image_presets, get_all_video_presets, IMAGE_STYLE_PRESETS, VIDEO_STYLE_PRESETS
from app.models.project import normalize_global_style_config

router = APIRouter()


@router.get("/global-style-config")
async def get_global_style_config(project_id: str) -> Dict[str, Any]:
    """获取项目的全局风格配置"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    current = ai_config.get("global_style_config")
    normalized = normalize_global_style_config(current)

    # 兜底时立即回写，确保后续 tools/conversation 与此接口一致
    if current != normalized:
        ai_config["global_style_config"] = normalized
        ProjectService.update_project(project_id, ai_config=ai_config)

    return normalized


@router.put("/global-style-config")
async def update_global_style_config(
    project_id: str,
    config: GlobalStyleConfigUpdate
) -> Dict[str, Any]:
    """更新项目的全局风格配置（支持部分更新）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    current_config = normalize_global_style_config(ai_config.get("global_style_config"))

    # 更新配置（只更新提供的字段）
    update_data = config.model_dump(exclude_unset=True)

    if "prompt_language" in update_data:
        current_config["prompt_language"] = update_data["prompt_language"]

    if "image_style" in update_data:
        if "image_style" not in current_config:
            current_config["image_style"] = {}
        current_config["image_style"].update(update_data["image_style"])

    if "video_style" in update_data:
        if "video_style" not in current_config:
            current_config["video_style"] = {}
        current_config["video_style"].update(update_data["video_style"])

    if "global_resolution" in update_data:
        current_config["global_resolution"] = update_data["global_resolution"]

    if "global_video_ratio" in update_data:
        current_config["global_video_ratio"] = update_data["global_video_ratio"]
    if "global_video_resolution" in update_data:
        current_config["global_video_resolution"] = update_data["global_video_resolution"]

    if "nine_grid_mode" in update_data:
        new_nine_grid = bool(update_data["nine_grid_mode"])
        old_nine_grid = bool(current_config.get("nine_grid_mode", False))
        current_config["nine_grid_mode"] = new_nine_grid

        # 同步切换对应模板的激活预设
        if new_nine_grid != old_nine_grid:
            prompt_overrides = ai_config.get("prompt_overrides", {})
            nine_grid_presets = {
                "video": "nine_grid",
                "storyboard": "nine_grid",
                "storyboard_image_edit": "story_nine_grid",
            }
            if new_nine_grid:
                # 切换到九宫格预设（仅当前不是自定义模板时）
                for ttype, preset_id in nine_grid_presets.items():
                    if ttype not in prompt_overrides:
                        prompt_overrides[ttype] = {"active": "default", "custom": {}}
                    active = prompt_overrides[ttype].get("active", "default")
                    if not active.startswith("custom_") and active != "legacy":
                        prompt_overrides[ttype]["active"] = preset_id
            else:
                # 切换回默认预设（仅当前激活的是九宫格预设时）
                for ttype, preset_id in nine_grid_presets.items():
                    if ttype in prompt_overrides:
                        active = prompt_overrides[ttype].get("active", "default")
                        if active == preset_id:
                            prompt_overrides[ttype]["active"] = "default"
            ai_config["prompt_overrides"] = prompt_overrides

    if "storyboard_duration_seconds" in update_data:
        current_config["storyboard_duration_seconds"] = update_data["storyboard_duration_seconds"]
    if "dialogue_chars_max" in update_data:
        current_config["dialogue_chars_max"] = update_data["dialogue_chars_max"]

    # 保存到项目metadata
    ai_config["global_style_config"] = current_config
    ProjectService.update_project(project_id, ai_config=ai_config)

    return current_config


@router.get("/style-presets")
async def get_style_presets(project_id: str) -> Dict[str, Any]:
    """获取所有风格预设列表（用于前端展示）"""
    return {
        "image_presets": get_all_image_presets(),
        "video_presets": get_all_video_presets()
    }


@router.get("/style-presets/detail/{preset_type}/{preset_id}")
async def get_style_preset_detail(
    project_id: str,
    preset_type: str,  # "image" or "video"
    preset_id: str
) -> Dict[str, Any]:
    """获取特定预设的详细信息（用于预览风格后缀）"""
    if preset_type == "image":
        preset = IMAGE_STYLE_PRESETS.get(preset_id)
    elif preset_type == "video":
        preset = VIDEO_STYLE_PRESETS.get(preset_id)
    else:
        raise HTTPException(status_code=400, detail="Invalid preset_type, must be 'image' or 'video'")

    if not preset:
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")

    return preset
