"""
全局默认提示词管理 API
GET  /global/prompt-templates  - 返回所有提示词（新扁平格式）
PUT  /global/prompt-templates  - 更新一个或多个提示词的全局默认内容
POST /global/prompt-templates/reset - 恢复出厂默认
"""
from fastapi import APIRouter
from typing import Dict, Any

from app.services.global_prompt_service import (
    load_prompts,
    save_prompts,
    invalidate_cache,
    reset_to_defaults,
)

router = APIRouter(prefix="/global/prompt-templates", tags=["global-prompts"])


@router.get("")
async def get_global_prompt_templates() -> Dict[str, Any]:
    """获取所有全局提示词（扁平格式，含 label/category/presets）"""
    return load_prompts()


@router.put("")
async def update_global_prompt_templates(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    更新全局提示词（部分更新，深度合并）。

    接受任意 key 的更新，例如：
    {
      "image": { "presets": { "default": { "content": "新内容" } } },
      "character_analysis": { "presets": { "default": { "content": "新内容" } } }
    }
    """
    current = load_prompts()

    for key, update in data.items():
        if key not in current:
            continue
        if not isinstance(update, dict):
            continue
        # 深度合并 presets
        if "presets" in update:
            for preset_id, preset_data in update["presets"].items():
                if preset_id not in current[key]["presets"]:
                    current[key]["presets"][preset_id] = preset_data
                elif isinstance(preset_data, dict):
                    current[key]["presets"][preset_id].update(preset_data)
        # 允许更新 label、category（管理员级操作）
        for field in ("label", "category"):
            if field in update:
                current[key][field] = update[field]

    save_prompts(current)
    return current


@router.post("/reset")
async def reset_global_prompt_templates() -> Dict[str, Any]:
    """将所有全局提示词重置为出厂默认值（backend/app/default_prompt_templates.json）"""
    invalidate_cache()
    return reset_to_defaults()
