"""工具注册表：统一导出工具定义和执行入口"""
from typing import Dict

from .definitions import TOOLS, OPENAI_TOOLS, ASSET_ONLY_TOOLS
from .assets import (
    handle_create_character, handle_create_scene, handle_create_prop,
    handle_create_episode, handle_generate_storyboard,
    handle_update_character, handle_update_scene, handle_update_prop,
    handle_update_episode, handle_create_child_asset,
)
from .storyboards import (
    handle_create_storyboard, handle_update_storyboard,
    handle_delete_storyboard, handle_insert_storyboard,
    handle_delete_all_storyboards,
)
from .queries import (
    handle_list_assets, handle_get_asset, handle_list_storyboards,
    handle_get_storyboard, handle_get_project_config, handle_get_ai_instructions,
    handle_get_prompt_template, handle_list_all_assets, handle_get_episode_storyboards,
    handle_get_episode_script, handle_get_episode_reverse_detail, handle_estimate_storyboard_plan,
)
from .config import (
    handle_update_project_config, handle_update_ai_instructions,
    handle_update_prompt_template, handle_update_episode_script,
)
from .generation import (
    handle_generate_asset_image, handle_generate_all_asset_images,
    handle_generate_storyboard_image, handle_generate_storyboard_video,
    handle_generate_storyboard_video_prompt_subagent,
    handle_generate_all_storyboard_images, handle_generate_all_storyboard_videos,
    handle_submit_images_for_review,
)
from .scripts import (
    handle_create_script, handle_import_script_content,
    handle_add_script_character, handle_add_script_scene,
)

# 需要用户确认的工具集合
CONFIRMATION_REQUIRED_TOOLS = {
    "update_project_config",
    "update_ai_instructions",
    "update_prompt_template",
    "generate_asset_image",
    "generate_storyboard_image",
    "generate_storyboard_video",
    "generate_all_asset_images",
    "generate_all_storyboard_images",
    "generate_all_storyboard_videos",
    "delete_all_storyboards",
    "submit_images_for_review",
}

# 工具名 → handler 映射（不需要 ai_config 的工具）
_HANDLERS = {
    "create_character": handle_create_character,
    "create_scene": handle_create_scene,
    "create_prop": handle_create_prop,
    "create_episode": handle_create_episode,
    "update_character": handle_update_character,
    "update_scene": handle_update_scene,
    "update_prop": handle_update_prop,
    "update_episode": handle_update_episode,
    "create_child_asset": handle_create_child_asset,
    "create_storyboard": handle_create_storyboard,
    "update_storyboard": handle_update_storyboard,
    "delete_storyboard": handle_delete_storyboard,
    "insert_storyboard": handle_insert_storyboard,
    "delete_all_storyboards": handle_delete_all_storyboards,
    "list_assets": handle_list_assets,
    "get_asset": handle_get_asset,
    "list_storyboards": handle_list_storyboards,
    "get_storyboard": handle_get_storyboard,
    "get_project_config": handle_get_project_config,
    "get_ai_instructions": handle_get_ai_instructions,
    "get_prompt_template": handle_get_prompt_template,
    "list_all_assets": handle_list_all_assets,
    "get_episode_storyboards": handle_get_episode_storyboards,
    "get_episode_script": handle_get_episode_script,
    "get_episode_reverse_detail": handle_get_episode_reverse_detail,
    "update_project_config": handle_update_project_config,
    "update_ai_instructions": handle_update_ai_instructions,
    "update_prompt_template": handle_update_prompt_template,
    "update_episode_script": handle_update_episode_script,
    "generate_storyboard_image": handle_generate_storyboard_image,
    "generate_all_storyboard_images": handle_generate_all_storyboard_images,
    "create_script": handle_create_script,
    "import_script_content": handle_import_script_content,
    "add_script_character": handle_add_script_character,
    "add_script_scene": handle_add_script_scene,
    "submit_images_for_review": handle_submit_images_for_review,
    "generate_storyboard_video": handle_generate_storyboard_video,
    "generate_all_storyboard_videos": handle_generate_all_storyboard_videos,
}

# 需要 ai_config 的工具（生成类）
_AI_CONFIG_HANDLERS = {
    "generate_storyboard": handle_generate_storyboard,
    "generate_asset_image": handle_generate_asset_image,
    "generate_all_asset_images": handle_generate_all_asset_images,
    "generate_storyboard_video_prompt_subagent": handle_generate_storyboard_video_prompt_subagent,
    "estimate_storyboard_plan": handle_estimate_storyboard_plan,
}


async def execute_tool_call(project_id: str, tool_name: str, parameters: Dict, ai_config: Dict = None) -> Dict:
    """统一工具执行入口"""
    try:
        if tool_name in _AI_CONFIG_HANDLERS:
            return await _AI_CONFIG_HANDLERS[tool_name](project_id, parameters, ai_config or {})
        if tool_name in _HANDLERS:
            return await _HANDLERS[tool_name](project_id, parameters)
        return {"success": False, "error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


__all__ = [
    "TOOLS", "OPENAI_TOOLS", "ASSET_ONLY_TOOLS",
    "CONFIRMATION_REQUIRED_TOOLS",
    "execute_tool_call",
]
