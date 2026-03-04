"""
分镜资产提取与匹配服务

提供两个独立操作：
1. extract_assets_from_storyboards - 从分镜内容中提取重要资产并创建
2. match_assets_to_storyboards    - 将资产库中的资产批量匹配到分镜
"""
import json
import re
import uuid
from datetime import datetime
from typing import Dict, List, Tuple

from app.services.asset_service import AssetService
from app.services.ai_service import get_ai_service
from app.services.global_prompt_service import get_prompt_content


def _safe_format(template: str, **kwargs) -> str:
    """安全替换模板变量，不会因模板中含 { } 的 JSON 示例而抛出 KeyError。"""
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _build_storyboard_text(sb: Dict) -> str:
    """将单个分镜的关键字段合并为可读文本"""
    parts = []
    if sb.get("description"):
        parts.append(f"画面：{sb['description']}")
    if sb.get("dialogue"):
        parts.append(f"对白：{sb['dialogue']}")
    if sb.get("action"):
        parts.append(f"动作：{sb['action']}")
    return "；".join(parts) if parts else "（无描述）"


def _extract_json_object(text: str) -> Dict:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return {}


def _extract_json_array(text: str) -> List:
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        return json.loads(match.group())
    return []


def _is_duplicate(name: str, existing: List[Dict]) -> bool:
    """简单名称去重：忽略大小写和空格"""
    normalized = name.strip().lower()
    for asset in existing:
        if asset.get("name", "").strip().lower() == normalized:
            return True
    return False


async def extract_assets_from_storyboards(
    project_id: str,
    episode_id: str,
    ai_config: Dict
) -> Dict:
    """
    从指定剧集的分镜内容中提取重要资产并创建。

    Returns:
        {
            "created": {"characters": [...], "scenes": [...], "props": [...]},
            "skipped_count": N  # 因重复跳过的资产数
        }
    """
    llm = get_ai_service(ai_config, "llm", project_id)

    # 1. 加载该剧集的分镜
    all_storyboards = AssetService.list_assets(project_id, "storyboard")
    storyboards = [sb for sb in all_storyboards if sb.get("episode_id") == episode_id]
    if not storyboards:
        return {"created": {"characters": [], "scenes": [], "props": []}, "skipped_count": 0}

    # 2. 加载现有资产（用于去重提示和本地去重）
    existing_characters = AssetService.list_assets(project_id, "character")
    existing_scenes = AssetService.list_assets(project_id, "scene")
    existing_props = AssetService.list_assets(project_id, "prop")

    existing_summary_parts = []
    if existing_characters:
        names = "、".join(c["name"] for c in existing_characters)
        existing_summary_parts.append(f"角色：{names}")
    if existing_scenes:
        names = "、".join(s["name"] for s in existing_scenes)
        existing_summary_parts.append(f"场景：{names}")
    if existing_props:
        names = "、".join(p["name"] for p in existing_props)
        existing_summary_parts.append(f"道具：{names}")
    existing_summary = "\n".join(existing_summary_parts) if existing_summary_parts else "（暂无）"

    # 3. 合并分镜描述
    sb_lines = []
    for i, sb in enumerate(storyboards, 1):
        sb_lines.append(f"第{i}镜：{_build_storyboard_text(sb)}")
    storyboard_descriptions = "\n".join(sb_lines)

    # 4. LLM 提取
    template = get_prompt_content("storyboard_asset_extraction", ai_config)
    prompt = _safe_format(
        template,
        existing_assets_summary=existing_summary,
        storyboard_descriptions=storyboard_descriptions,
    )
    result = await llm.chat([{"role": "user", "content": prompt}])
    content = result.get("content", "")

    try:
        extracted = _extract_json_object(content)
    except Exception:
        extracted = {}

    # 5. 创建资产（跳过重复）
    created = {"characters": [], "scenes": [], "props": []}
    skipped_count = 0
    now = datetime.now().isoformat()

    for char in extracted.get("characters", []):
        name = (char.get("name") or "").strip()
        if not name:
            continue
        if _is_duplicate(name, existing_characters):
            skipped_count += 1
            continue
        new_asset = {
            "asset_id": str(uuid.uuid4()),
            "name": name,
            "description": char.get("description", ""),
            "gender": char.get("gender", ""),
            "age": char.get("age", ""),
            "created_at": now,
        }
        saved = AssetService.save_asset(project_id, "character", new_asset)
        created["characters"].append(saved)
        existing_characters.append(saved)  # 防止同批次重复

    for scene in extracted.get("scenes", []):
        name = (scene.get("name") or "").strip()
        if not name:
            continue
        if _is_duplicate(name, existing_scenes):
            skipped_count += 1
            continue
        new_asset = {
            "asset_id": str(uuid.uuid4()),
            "name": name,
            "description": scene.get("description", ""),
            "location": scene.get("location", ""),
            "time_of_day": scene.get("time_of_day", ""),
            "mood": scene.get("mood", ""),
            "created_at": now,
        }
        saved = AssetService.save_asset(project_id, "scene", new_asset)
        created["scenes"].append(saved)
        existing_scenes.append(saved)

    for prop in extracted.get("props", []):
        name = (prop.get("name") or "").strip()
        if not name:
            continue
        if _is_duplicate(name, existing_props):
            skipped_count += 1
            continue
        new_asset = {
            "asset_id": str(uuid.uuid4()),
            "name": name,
            "description": prop.get("description", ""),
            "category": prop.get("category", ""),
            "created_at": now,
        }
        saved = AssetService.save_asset(project_id, "prop", new_asset)
        created["props"].append(saved)
        existing_props.append(saved)

    return {"created": created, "skipped_count": skipped_count}


async def match_assets_to_storyboards(
    project_id: str,
    episode_id: str,
    ai_config: Dict,
    overwrite_existing: bool = False,
) -> Dict:
    """
    将资产库中的资产批量匹配到指定剧集的所有分镜。

    Args:
        overwrite_existing: False = 仅填充空白字段；True = 覆盖已有关联

    Returns:
        {"updated_count": N, "updated_storyboard_ids": [...]}
    """
    llm = get_ai_service(ai_config, "llm", project_id)

    # 1. 加载分镜
    all_storyboards = AssetService.list_assets(project_id, "storyboard")
    storyboards = [sb for sb in all_storyboards if sb.get("episode_id") == episode_id]
    if not storyboards:
        return {"updated_count": 0, "updated_storyboard_ids": []}

    # 2. 加载资产库
    characters = AssetService.list_assets(project_id, "character")
    scenes = AssetService.list_assets(project_id, "scene")
    props = AssetService.list_assets(project_id, "prop")

    if not characters and not scenes and not props:
        return {"updated_count": 0, "updated_storyboard_ids": []}

    # 3. 构建资产列表文本（含 ID，供 LLM 直接引用）
    def fmt_asset(a: Dict) -> str:
        return f"  ID={a['asset_id']} 名称={a['name']} 描述={a.get('description', '')[:60]}"

    characters_list = "\n".join(fmt_asset(c) for c in characters) or "（无）"
    scenes_list = "\n".join(fmt_asset(s) for s in scenes) or "（无）"
    props_list = "\n".join(fmt_asset(p) for p in props) or "（无）"

    # 4. 构建分镜列表文本
    sb_entries = []
    for sb in storyboards:
        sb_entries.append(
            f"  ID={sb['asset_id']} 第{sb.get('sequence', '?')}镜：{_build_storyboard_text(sb)}"
        )
    storyboards_list = "\n".join(sb_entries)

    # 5. LLM 匹配
    template = get_prompt_content("storyboard_asset_batch_matching", ai_config)
    prompt = _safe_format(
        template,
        characters_list=characters_list,
        scenes_list=scenes_list,
        props_list=props_list,
        storyboards_list=storyboards_list,
    )
    result = await llm.chat([{"role": "user", "content": prompt}])
    content = result.get("content", "")

    try:
        matching_results = _extract_json_array(content)
    except Exception:
        matching_results = []

    # 6. 更新分镜文件
    valid_char_ids = {c["asset_id"] for c in characters}
    valid_scene_ids = {s["asset_id"] for s in scenes}
    valid_prop_ids = {p["asset_id"] for p in props}

    updated_count = 0
    updated_storyboard_ids = []

    for match in matching_results:
        sb_id = match.get("storyboard_id", "")
        sb = AssetService.load_asset(project_id, "storyboard", sb_id)
        if not sb:
            continue

        changed = False

        # 角色
        new_char_ids = [i for i in match.get("character_ids", []) if i in valid_char_ids]
        if new_char_ids and (overwrite_existing or not sb.get("character_ids")):
            sb["character_ids"] = new_char_ids
            changed = True

        # 场景
        new_scene_id = match.get("scene_id", "")
        if new_scene_id and new_scene_id in valid_scene_ids:
            if overwrite_existing or not sb.get("scene_id"):
                sb["scene_id"] = new_scene_id
                changed = True

        # 道具
        new_prop_ids = [i for i in match.get("prop_ids", []) if i in valid_prop_ids]
        if new_prop_ids and (overwrite_existing or not sb.get("prop_ids")):
            sb["prop_ids"] = new_prop_ids
            changed = True

        if changed:
            AssetService.save_asset(project_id, "storyboard", sb)
            updated_count += 1
            updated_storyboard_ids.append(sb_id)

    return {"updated_count": updated_count, "updated_storyboard_ids": updated_storyboard_ids}
