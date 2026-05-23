"""分镜工具执行逻辑"""
import uuid
from datetime import datetime
from typing import Dict
from app.services import AssetService
from .helpers import _resolve_episode_id, validate_asset_refs, validate_declared_dialogue


def _validate_dialogue_payload(project_id: str, parameters: Dict) -> Dict:
    check = validate_declared_dialogue(project_id, parameters)
    if not check.get("ok"):
        return {
            "success": False,
            "error": check.get("error", "对白审计失败"),
            "dialogue_audit": check.get("audit"),
        }
    return {
        "success": True,
        "dialogue_audit": check.get("audit"),
    }


async def handle_create_storyboard(project_id: str, parameters: Dict) -> Dict:
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    if "sequence" not in parameters:
        return {"success": False, "error": "缺少必需字段: sequence"}
    if "duration" not in parameters:
        parameters["duration"] = 15
    if not str(parameters.get("description") or "").strip():
        return {"success": False, "error": "缺少必需字段: description（必须填写剧本原文片段）"}

    episode_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
    if ep_err:
        return {"success": False, "error": ep_err}
    parameters["episode_id"] = episode_id

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    ref_err = validate_asset_refs(
        project_id,
        parameters.get("character_ids", []),
        parameters.get("scene_ids", []) or ([parameters["scene_id"]] if parameters.get("scene_id") else []),
        parameters.get("prop_ids", [])
    )
    if ref_err:
        return {"success": False, "error": ref_err}

    # 检查 sequence 重复
    all_sbs = AssetService.list_assets(project_id, "storyboard") or []
    ep_seqs = [sb.get("sequence") for sb in all_sbs if sb.get("episode_id") == episode_id]
    if parameters["sequence"] in ep_seqs:
        return {"success": False, "error": f"sequence {parameters['sequence']} 已存在，请调用 get_episode_storyboards 查看当前分镜列表后重试"}

    dialogue_audit = None
    dialogue_check = _validate_dialogue_payload(project_id, parameters)
    if not dialogue_check.get("success"):
        return dialogue_check
    dialogue_audit = dialogue_check.get("dialogue_audit")

    result = AssetService.save_asset(project_id, "storyboard", parameters)
    existing_ids = episode.get("storyboard_ids", [])
    if result["asset_id"] not in existing_ids:
        episode["storyboard_ids"] = existing_ids + [result["asset_id"]]
        episode["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "episode", episode)

    response = {"success": True, "storyboard_id": result["asset_id"], "sequence": result.get("sequence"), "description": result.get("description")}
    if dialogue_audit is not None:
        response["dialogue_audit"] = dialogue_audit
    return response


async def handle_update_storyboard(project_id: str, parameters: Dict) -> Dict:
    storyboard_id = parameters.get("storyboard_id")
    if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
        resolved_ep_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
        if ep_err:
            return {"success": False, "error": ep_err}
        for sb in AssetService.list_assets(project_id, "storyboard"):
            if sb.get("episode_id") == resolved_ep_id and sb.get("sequence") == parameters["sequence"]:
                storyboard_id = sb["asset_id"]
                break
        if not storyboard_id:
            return {"success": False, "error": f"未找到第{parameters['sequence']}镜，请检查episode_id和sequence是否正确"}
    if not storyboard_id:
        return {"success": False, "error": "需要提供 storyboard_id 或 (episode_id + sequence)"}

    current = AssetService.load_asset(project_id, "storyboard", storyboard_id)
    if not current:
        return {"success": False, "error": "分镜不存在"}

    if "description" in parameters and parameters["description"]:
        current["description"] = parameters["description"]

    for key in [
        "action", "dialogue", "camera_angle", "shot_type", "character_ids", "scene_id", "scene_ids", "prop_ids",
        "video_prompt", "duration", "image_prompt", "dialogue_units", "dialogue_chars_declared", "short_dialogue_reason", "short_dialogue_time_evidence", "script_scene_label"
    ]:
        if key in parameters and parameters[key] is not None:
            current[key] = parameters[key]

    dialogue_audit = None
    need_dialogue_validation = any(k in parameters for k in ["video_prompt", "dialogue_units", "dialogue_chars_declared", "short_dialogue_reason", "short_dialogue_time_evidence"])
    if need_dialogue_validation:
        dialogue_payload = {
            "episode_id": current.get("episode_id"),
            "sequence": current.get("sequence"),
            "description": current.get("description", ""),
            "video_prompt": current.get("video_prompt", ""),
            "dialogue_units": current.get("dialogue_units"),
            "dialogue_chars_declared": current.get("dialogue_chars_declared"),
            "short_dialogue_reason": current.get("short_dialogue_reason"),
            "short_dialogue_time_evidence": current.get("short_dialogue_time_evidence"),
            "script_scene_label": current.get("script_scene_label"),
        }
        dialogue_check = _validate_dialogue_payload(project_id, dialogue_payload)
        if not dialogue_check.get("success"):
            return dialogue_check
        dialogue_audit = dialogue_check.get("dialogue_audit")

    ref_err = validate_asset_refs(
        project_id,
        current.get("character_ids", []),
        current.get("scene_ids", []) or ([current["scene_id"]] if current.get("scene_id") else []),
        current.get("prop_ids", [])
    )
    if ref_err:
        return {"success": False, "error": ref_err}

    current["updated_at"] = datetime.now().isoformat()
    result = AssetService.save_asset(project_id, "storyboard", current)
    response = {
        "success": True, "storyboard_id": result["asset_id"], "sequence": result.get("sequence"),
        "character_ids": result.get("character_ids", []), "scene_ids": result.get("scene_ids", []),
        "prop_ids": result.get("prop_ids", []),
        "video_prompt_preview": (result.get("video_prompt") or "")[:80],
        "image_prompt_preview": (result.get("image_prompt") or "")[:80],
        "updated": True
    }
    if dialogue_audit is not None:
        response["dialogue_audit"] = dialogue_audit
    return response


async def handle_delete_storyboard(project_id: str, parameters: Dict) -> Dict:
    storyboard_id = parameters.get("storyboard_id")
    if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
        resolved_ep_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
        if ep_err:
            return {"success": False, "error": ep_err}
        for sb in AssetService.list_assets(project_id, "storyboard"):
            if sb.get("episode_id") == resolved_ep_id and sb.get("sequence") == parameters["sequence"]:
                storyboard_id = sb["asset_id"]
                break
        if not storyboard_id:
            return {"success": False, "error": f"未找到第{parameters['sequence']}镜"}
    if not storyboard_id:
        return {"success": False, "error": "需要提供 storyboard_id 或 (episode_id + sequence)"}

    storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
    if not storyboard:
        return {"success": False, "error": "分镜不存在"}

    has_content = bool(storyboard.get("video_prompt") or storyboard.get("description"))
    if has_content and not parameters.get("confirmed", False):
        seq = storyboard.get("sequence", "?")
        desc = (storyboard.get("video_prompt") or storyboard.get("description") or "")[:60]
        return {"success": False, "error": f"⚠️ 第{seq}镜已有内容（{desc}...），删除前请向用户确认，确认后传入 confirmed=true 重新调用"}

    episode_id = storyboard.get("episode_id")
    result = AssetService.delete_asset(project_id, "storyboard", storyboard_id)
    if not result:
        return {"success": False, "error": "删除分镜失败"}

    if episode_id:
        episode = AssetService.load_asset(project_id, "episode", episode_id)
        if episode:
            episode["storyboard_ids"] = [sid for sid in episode.get("storyboard_ids", []) if sid != storyboard_id]
            episode["updated_at"] = datetime.now().isoformat()
            AssetService.save_asset(project_id, "episode", episode)

    return {"success": True, "deleted": True, "storyboard_id": storyboard_id}


async def handle_delete_all_storyboards(project_id: str, parameters: Dict) -> Dict:
    """删除某集的全部分镜（一次确认，原子操作）"""
    episode_id = parameters.get("episode_id")
    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}

    from .helpers import _resolve_episode_id
    episode_id, ep_err = _resolve_episode_id(project_id, episode_id)
    if ep_err:
        return {"success": False, "error": ep_err}

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    all_storyboards = AssetService.list_assets(project_id, "storyboard")
    episode_storyboards = [sb for sb in all_storyboards if sb.get("episode_id") == episode_id]

    if not episode_storyboards:
        return {"success": True, "deleted_count": 0, "message": "该集没有分镜，无需删除"}

    if not parameters.get("confirmed", False):
        count = len(episode_storyboards)
        return {
            "success": False,
            "error": f"⚠️ 即将删除第{episode.get('name', '')}集的全部 {count} 个分镜，此操作不可撤销。确认后传入 confirmed=true 重新调用"
        }

    deleted_count = 0
    for sb in episode_storyboards:
        result = AssetService.delete_asset(project_id, "storyboard", sb["asset_id"])
        if result:
            deleted_count += 1

    episode["storyboard_ids"] = []
    episode["updated_at"] = datetime.now().isoformat()
    AssetService.save_asset(project_id, "episode", episode)

    return {"success": True, "deleted_count": deleted_count, "message": f"已删除 {deleted_count} 个分镜"}


async def handle_insert_storyboard(project_id: str, parameters: Dict) -> Dict:
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    if "insert_at_sequence" not in parameters:
        return {"success": False, "error": "缺少必需字段: insert_at_sequence"}
    if "description" not in parameters:
        return {"success": False, "error": "缺少必需字段: description"}

    episode_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
    if ep_err:
        return {"success": False, "error": ep_err}
    insert_at = parameters["insert_at_sequence"]

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    all_storyboards = AssetService.list_assets(project_id, "storyboard")
    episode_storyboards = sorted(
        [sb for sb in all_storyboards if sb.get("episode_id") == episode_id],
        key=lambda x: x.get("sequence", 0)
    )

    moved_count = 0
    for sb in episode_storyboards:
        if sb.get("sequence", 0) >= insert_at:
            sb["sequence"] = sb.get("sequence", 0) + 1
            sb["updated_at"] = datetime.now().isoformat()
            AssetService.save_asset(project_id, "storyboard", sb)
            moved_count += 1

    ref_err = validate_asset_refs(
        project_id,
        parameters.get("character_ids", []),
        parameters.get("scene_ids", []) or ([parameters["scene_id"]] if parameters.get("scene_id") else []),
        parameters.get("prop_ids", [])
    )
    if ref_err:
        return {"success": False, "error": ref_err}

    new_storyboard = {
        "asset_id": str(uuid.uuid4()),
        "episode_id": episode_id,
        "sequence": insert_at,
        "description": parameters.get("description", ""),
        "script_scene_label": parameters.get("script_scene_label", ""),
        "video_prompt": parameters.get("video_prompt", ""),
        "duration": parameters.get("duration", 15),
        "action": parameters.get("action", ""),
        "dialogue": parameters.get("dialogue", ""),
        "camera_angle": parameters.get("camera_angle", ""),
        "shot_type": parameters.get("shot_type", ""),
        "character_ids": parameters.get("character_ids", []),
        "scene_id": parameters.get("scene_id", ""),
        "scene_ids": parameters.get("scene_ids", []),
        "prop_ids": parameters.get("prop_ids", []),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat()
    }

    dialogue_audit = None
    dialogue_payload = {
        "episode_id": episode_id,
        "sequence": insert_at,
        "description": parameters.get("description", ""),
        "video_prompt": new_storyboard.get("video_prompt", ""),
        "dialogue_units": parameters.get("dialogue_units"),
        "dialogue_chars_declared": parameters.get("dialogue_chars_declared"),
        "short_dialogue_reason": parameters.get("short_dialogue_reason"),
        "short_dialogue_time_evidence": parameters.get("short_dialogue_time_evidence"),
        "script_scene_label": parameters.get("script_scene_label"),
    }
    dialogue_check = _validate_dialogue_payload(project_id, dialogue_payload)
    if not dialogue_check.get("success"):
        return dialogue_check
    dialogue_audit = dialogue_check.get("dialogue_audit")

    new_storyboard["dialogue_units"] = parameters.get("dialogue_units", [])
    new_storyboard["dialogue_chars_declared"] = parameters.get("dialogue_chars_declared")
    if parameters.get("short_dialogue_reason") is not None:
        new_storyboard["short_dialogue_reason"] = parameters.get("short_dialogue_reason")
    if parameters.get("short_dialogue_time_evidence") is not None:
        new_storyboard["short_dialogue_time_evidence"] = parameters.get("short_dialogue_time_evidence")
    result = AssetService.save_asset(project_id, "storyboard", new_storyboard)

    existing_ids = episode.get("storyboard_ids", [])
    if result["asset_id"] not in existing_ids:
        episode["storyboard_ids"] = existing_ids + [result["asset_id"]]
        episode["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "episode", episode)

    response = {"success": True, "storyboard_id": result["asset_id"], "sequence": insert_at,
            "description": result.get("description"), "moved_count": moved_count}
    if dialogue_audit is not None:
        response["dialogue_audit"] = dialogue_audit
    return response
