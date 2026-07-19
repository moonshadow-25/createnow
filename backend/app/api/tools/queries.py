"""查询工具执行逻辑"""
import json
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from app.services import AssetService, ImageService, ProjectService, get_ai_service
from app.models.project import normalize_global_style_config
from .helpers import check_asset_exists, KEY_ALIASES, count_dialogue_chars


def _validate_segments(script: str, segments: list) -> Dict:
    """校验分段方案：字数上限、末段完整性。纯 Python，不涉及 LLM。"""
    if not segments or not isinstance(segments, list):
        return {"ok": False, "error": "segments 为空或格式错误"}

    lines = script.splitlines()
    total_lines = len(lines)
    if total_lines == 0:
        return {"ok": False, "error": "剧本为空"}

    max_allowed = 100
    char_details = []  # 收集所有段字数
    has_error = False
    error_lines = []   # 逐行错误（单一 fatal error 用）
    last_end = 0

    for i, seg in enumerate(segments):
        seq = seg.get("sequence", i + 1)
        start = seg.get("line_start")
        end = seg.get("line_end")
        dialogue_units = seg.get("dialogue_units")

        # 基本合法性
        if not isinstance(start, int) or not isinstance(end, int) or start < 1:
            error_lines.append(f"第{seq}段 line_start 无效: {start}")
            has_error = True
            continue
        if start > end:
            error_lines.append(f"第{seq}段 line_start({start}) > line_end({end})")
            has_error = True
            continue
        if end > total_lines:
            error_lines.append(f"第{seq}段 line_end({end}) 超出剧本总行数({total_lines})")
            has_error = True
            continue

        last_end = end

        # 字数校验
        if not isinstance(dialogue_units, list):
            error_lines.append(f"第{seq}段 dialogue_units 必须是数组")
            has_error = True
            continue
        actual = count_dialogue_chars(dialogue_units)
        ok = actual <= max_allowed
        char_details.append({"seq": seq, "chars": actual, "ok": ok})
        if not ok:
            has_error = True

    if error_lines:
        return {"ok": False, "error": "; ".join(error_lines)}

    # 末段完整性（闭区间）
    if last_end < total_lines:
        has_error = True
        char_details.append({"seq": "末段", "chars": 0, "ok": False, "note": f"line_end({last_end}) 未覆盖剧本末行({total_lines})，有{total_lines - last_end}行遗漏"})

    if has_error:
        detail_str = "\n".join(
            f"  第{d['seq']}段: {d['chars']}字 {'✅' if d.get('ok') else '❌ 超限'}" + (f" ({d.get('note')})" if d.get('note') else "")
            for d in char_details
        )
        return {
            "ok": False,
            "error": f"各段对白字数（上限{max_allowed}字）：\n{detail_str}\n请根据以上各段实际字数，整体重新规划 segments，确保每段 ≤{max_allowed}。",
        }

    return {"ok": True}


def _batch_create_storyboards_from_segments(project_id: str, episode_id: str, segments: list, plan_id: str) -> Dict:
    """用校验通过的 segments 批量创建分镜，纯后端操作，不涉及 LLM。"""
    from datetime import datetime as dt
    created = []
    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    script = str(episode.get("script") or "").strip()
    lines = script.splitlines()

    existing_ids = list(episode.get("storyboard_ids", []))

    for seg in segments:
        start = seg.get("line_start")
        end = seg.get("line_end")
        # 后端按行号裁切 description（闭区间 [start, end]）
        description = "\n".join(lines[start - 1:end])
        sb_data = {
            "asset_id": str(uuid.uuid4()),
            "episode_id": episode_id,
            "plan_id": plan_id,
            "sequence": seg.get("sequence"),
            "script_scene_label": seg.get("scene_label", ""),
            "description": description,
            "dialogue_units": seg.get("dialogue_units", []),
            "dialogue_chars_declared": count_dialogue_chars(seg.get("dialogue_units", [])),
            "character_ids": seg.get("character_ids", []),
            "scene_ids": seg.get("scene_ids", []),
            "duration": 15,
            "created_at": dt.now().isoformat(),
            "updated_at": dt.now().isoformat(),
        }
        result = AssetService.save_asset(project_id, "storyboard", sb_data)
        created.append({
            "storyboard_id": result["asset_id"],
            "sequence": result.get("sequence"),
        })
        if result["asset_id"] not in existing_ids:
            existing_ids.append(result["asset_id"])

    episode["storyboard_ids"] = existing_ids
    episode["updated_at"] = dt.now().isoformat()
    AssetService.save_asset(project_id, "episode", episode)

    return {"success": True, "created": created, "count": len(created)}


async def handle_list_assets(project_id: str, parameters: Dict) -> Dict:
    if "asset_type" not in parameters:
        return {"success": False, "error": "缺少必需字段: asset_type"}
    asset_type = parameters["asset_type"]
    if asset_type not in ["character", "scene", "prop", "episode"]:
        return {"success": False, "error": f"不支持的资产类型: {asset_type}"}
    try:
        assets = AssetService.list_assets(project_id, asset_type)
        return {"success": True, "asset_type": asset_type, "count": len(assets), "assets": assets}
    except Exception as e:
        return {"success": False, "error": f"列出资产失败: {str(e)}"}


async def handle_get_asset(project_id: str, parameters: Dict) -> Dict:
    if "asset_type" not in parameters:
        return {"success": False, "error": "缺少必需字段: asset_type"}
    asset_type = parameters["asset_type"]
    if asset_type not in ["character", "scene", "prop", "episode"]:
        return {"success": False, "error": f"不支持的资产类型: {asset_type}"}
    try:
        asset_id = parameters.get("asset_id")
        if not asset_id and "name" in parameters:
            existing = check_asset_exists(project_id, asset_type, parameters["name"])
            if existing:
                asset_id = existing["asset_id"]
            else:
                return {"success": False, "error": f"未找到资产: {parameters['name']}"}
        if not asset_id:
            return {"success": False, "error": "需要提供 asset_id 或 name"}
        asset = AssetService.load_asset(project_id, asset_type, asset_id)
        if not asset:
            return {"success": False, "error": "资产不存在"}
        return {"success": True, "asset": asset}
    except Exception as e:
        return {"success": False, "error": f"获取资产失败: {str(e)}"}


async def handle_list_storyboards(project_id: str, parameters: Dict) -> Dict:
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    try:
        storyboards = AssetService.list_assets(project_id, "storyboard")
        episode_storyboards = sorted(
            [sb for sb in storyboards if sb.get("episode_id") == parameters["episode_id"]],
            key=lambda x: x.get("sequence", 0)
        )
        return {"success": True, "episode_id": parameters["episode_id"], "count": len(episode_storyboards), "storyboards": episode_storyboards}
    except Exception as e:
        return {"success": False, "error": f"列出分镜失败: {str(e)}"}


async def handle_get_storyboard(project_id: str, parameters: Dict) -> Dict:
    try:
        storyboard_id = parameters.get("storyboard_id")
        if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
            for sb in AssetService.list_assets(project_id, "storyboard"):
                if sb.get("episode_id") == parameters["episode_id"] and sb.get("sequence") == parameters["sequence"]:
                    storyboard_id = sb["asset_id"]
                    break
            if not storyboard_id:
                return {"success": False, "error": f"未找到分镜: 第{parameters['sequence']}镜"}
        if not storyboard_id:
            return {"success": False, "error": "需要提供 storyboard_id 或 (episode_id + sequence)"}
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            return {"success": False, "error": "分镜不存在"}

        def _resolve_names(asset_type: str, ids: list) -> list:
            result = []
            for aid in (ids or []):
                asset = AssetService.load_asset(project_id, asset_type, aid)
                if not asset:
                    result.append({"asset_id": aid, "name": ""})
                    continue
                entry = {"asset_id": aid, "name": asset.get("name", "")}
                if asset_type == "character":
                    entry["voice_enabled"] = bool(asset.get("voice_enabled", True) and (asset.get("voice_audio_id") or asset.get("voice_id")))
                    entry["voice_audio_id"] = asset.get("voice_audio_id")
                    if asset.get("voice_id"):
                        entry["voice_id"] = asset["voice_id"]
                result.append(entry)
            return result

        resolved_assets = {
            "character_ids": _resolve_names("character", storyboard.get("character_ids", [])),
            "scene_ids": _resolve_names("scene", storyboard.get("scene_ids", [])),
            "prop_ids": _resolve_names("prop", storyboard.get("prop_ids", [])),
        }
        return {"success": True, "storyboard": storyboard, "resolved_assets": resolved_assets}
    except Exception as e:
        return {"success": False, "error": f"获取分镜失败: {str(e)}"}


async def handle_get_project_config(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        ai_cfg = proj.get("ai_config", {}) if proj else {}
        global_style = normalize_global_style_config(ai_cfg.get("global_style_config"))
        return {"success": True, "global_style_config": global_style}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_ai_instructions(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        instructions = proj.get("ai_instructions", "") if proj else ""
        return {"success": True, "ai_instructions": instructions or "（暂无自定义指令）"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_prompt_template(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services.global_prompt_service import get_prompt_content, load_prompts
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        ai_cfg = proj.get("ai_config", {}) if proj else {}
        key = KEY_ALIASES.get(parameters.get("key", ""), parameters.get("key", ""))
        content = get_prompt_content(key, ai_cfg)
        prompts = load_prompts()
        label = prompts.get(key, {}).get("label", key)
        default_preset = prompts.get(key, {}).get("presets", {}).get("default", {})
        variables = default_preset.get("variables", [])
        return {"success": True, "key": key, "label": label, "content": content or "（模板不存在）", "variables": variables}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_list_all_assets(project_id: str, parameters: Dict) -> Dict:
    """懒查询：获取项目所有资产列表（角色/场景/道具/剧集）"""
    try:
        result = {}
        for asset_type in ["character", "scene", "prop", "episode"]:
            assets = AssetService.list_assets(project_id, asset_type) or []
            items = []
            for a in assets:
                entry = {"asset_id": a.get("asset_id"), "name": a.get("name"), "description": (a.get("description") or "")[:80]}
                if asset_type == "character":
                    entry["voice_enabled"] = bool(a.get("voice_enabled", True) and (a.get("voice_audio_id") or a.get("voice_id")))
                    entry["voice_audio_id"] = a.get("voice_audio_id")
                    if a.get("voice_id"):
                        entry["voice_id"] = a["voice_id"]
                items.append(entry)
            result[asset_type] = items
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_episode_storyboards(project_id: str, parameters: Dict) -> Dict:
    """懒查询：获取指定剧集的完整分镜列表"""
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    try:
        storyboards = AssetService.list_assets(project_id, "storyboard") or []
        episode_storyboards = sorted(
            [sb for sb in storyboards if sb.get("episode_id") == parameters["episode_id"]],
            key=lambda x: x.get("sequence", 0)
        )
        return {"success": True, "episode_id": parameters["episode_id"], "count": len(episode_storyboards), "storyboards": episode_storyboards}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_episode_script(project_id: str, parameters: Dict) -> Dict:
    """读取当前剧集的完整剧本内容，同时返回项目已有资产列表"""
    episode_id = parameters.get("episode_id")
    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    try:
        from app.services import ProjectService
        from app.services.ai.adapters.byteseed import is_asset_unsupported_model

        episode = AssetService.load_asset(project_id, "episode", episode_id)
        if not episode:
            return {"success": False, "error": "剧集不存在"}
        project = ProjectService.get_project(project_id) or {}
        video_config = (project.get("ai_config") or {}).get("video", {})
        video_model = (video_config.get("model") or "").strip()
        asset_review_required = not is_asset_unsupported_model(video_model)
        script = episode.get("script", "")
        existing_assets = {}
        for asset_type in ["character", "scene", "prop"]:
            assets = AssetService.list_assets(project_id, asset_type) or []
            asset_ids = [a.get("asset_id") for a in assets if a.get("asset_id")]
            image_info = ImageService.get_primary_images_with_count_batch(project_id, asset_ids) if asset_ids else {}
            items = []
            for a in assets:
                aid = a.get("asset_id")
                info = image_info.get(aid, {})
                primary = info.get("primary_image")
                # 取审核状态：优先从 asset.image_id 对应的图片取
                review_status = None
                if primary:
                    ref = primary
                    if a.get("image_id"):
                        matched = next((img for img in info.get("images", []) if img.get("image_id") == a["image_id"]), None)
                        if matched:
                            ref = matched
                    review_status = ref.get("volcengine_asset_status")  # "Active" / "Processing" / None
                item = {
                    "asset_id": aid,
                    "name": a.get("name"),
                    "has_image_prompt": bool(a.get("image_prompt")),
                    "has_image": bool(a.get("image_id")),
                    "review_status": review_status,  # Active=审核通过, Processing=审核中, None=未提交
                    "asset_review_required": asset_review_required,
                }
                if asset_type == "character":
                    item["voice_enabled"] = bool(a.get("voice_enabled", True) and (a.get("voice_audio_id") or a.get("voice_id")))
                    item["voice_audio_id"] = a.get("voice_audio_id")
                    if a.get("voice_id"):
                        item["voice_id"] = a["voice_id"]
                items.append(item)
            existing_assets[asset_type] = items
        # 同时返回已有分镜数量
        all_storyboards = AssetService.list_assets(project_id, "storyboard") or []
        episode_storyboards = [sb for sb in all_storyboards if sb.get("episode_id") == episode_id]
        storyboard_count = len(episode_storyboards)

        line_numbered_script = ""
        if script:
            numbered_lines = [f"{i + 1}\t{line}" for i, line in enumerate(script.splitlines())]
            line_numbered_script = "\n".join(numbered_lines)

        return {
            "success": True,
            "episode_id": episode_id,
            "script": script or "（暂无剧本内容）",
            "line_numbered_script": line_numbered_script or "（暂无剧本内容）",
            "existing_assets": existing_assets,
            "asset_review_required": asset_review_required,
            "video_model": video_model,
            "existing_storyboard_count": storyboard_count,
            "notice": f"⚠️ 已有资产见 existing_assets，已存在的直接用 asset_id，禁止重复创建。本集已有 {storyboard_count} 个分镜{'，自动生成本集时应跳过创建分镜步骤，继续后续的生图/审核/视频流程' if storyboard_count > 0 else '，需要创建分镜'}。"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _line_number_text(text: str) -> str:
    return "\n".join(f"{idx}\t{line}" for idx, line in enumerate((text or "").splitlines(), start=1))


def _summarize_asset(asset: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "asset_id": asset.get("asset_id"),
        "name": asset.get("name", ""),
        "description": asset.get("description", ""),
        "image_prompt": asset.get("image_prompt", ""),
        "review_status": asset.get("review_status"),
        "has_image": bool(asset.get("image_url") or asset.get("image_path") or asset.get("url")),
    }


async def handle_get_episode_reverse_detail(project_id: str, parameters: Dict, ai_config: Optional[Dict] = None) -> Dict:
    """获取本集视频反推详情，供一键反推工具编排使用。"""
    episode_id = parameters.get("episode_id")
    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": f"剧集不存在: {episode_id}"}

    screenplay = episode.get("script", "") or episode.get("video_reverse_screenplay", "")
    reverse_screenplay = episode.get("video_reverse_screenplay", "") or screenplay
    reverse_segments = episode.get("video_reverse_segments", []) or []
    reverse_analysis = episode.get("video_reverse_analysis", {}) or {}
    reverse_raw = episode.get("video_reverse_raw", {}) or {}

    storyboards = [
        storyboard for storyboard in AssetService.list_assets(project_id, "storyboard")
        if storyboard.get("episode_id") == episode_id
    ]
    storyboards.sort(key=lambda item: item.get("sequence", 0))

    return {
        "success": True,
        "project_id": project_id,
        "episode_id": episode_id,
        "episode_name": episode.get("name", ""),
        "episode_number": episode.get("episode_number"),
        "screenplay": screenplay,
        "video_reverse_screenplay": reverse_screenplay,
        "line_numbered_screenplay": _line_number_text(screenplay),
        "line_numbered_reverse_screenplay": _line_number_text(reverse_screenplay),
        "video_reverse_segments": reverse_segments,
        "video_reverse_segment_prompts_text": episode.get("video_reverse_segment_prompts_text", ""),
        "video_reverse_drama_analysis_text": episode.get("video_reverse_drama_analysis_text", ""),
        "video_reverse_analysis": reverse_analysis,
        "video_reverse_raw": {
            "source_video": reverse_raw.get("source_video", {}),
            "model": reverse_raw.get("model"),
            "usage": reverse_raw.get("usage", {}),
        },
        "video_reverse_updated_at": episode.get("video_reverse_updated_at"),
        "existing_assets": {
            "characters": [_summarize_asset(asset) for asset in AssetService.list_assets(project_id, "character")],
            "scenes": [_summarize_asset(asset) for asset in AssetService.list_assets(project_id, "scene")],
            "props": [_summarize_asset(asset) for asset in AssetService.list_assets(project_id, "prop")],
        },
        "existing_storyboards": [
            {
                "storyboard_id": item.get("storyboard_id") or item.get("asset_id"),
                "asset_id": item.get("asset_id"),
                "sequence": item.get("sequence"),
                "description": item.get("description", ""),
                "duration": item.get("duration"),
                "has_video_prompt": bool(item.get("video_prompt")),
                "character_ids": item.get("character_ids", []),
                "scene_ids": item.get("scene_ids") or ([item.get("scene_id")] if item.get("scene_id") else []),
                "prop_ids": item.get("prop_ids", []),
            }
            for item in storyboards
        ],
    }


async def handle_estimate_storyboard_plan(project_id: str, parameters: Dict, ai_config: Optional[Dict] = None) -> Dict:
    """接收 LLM 规划的 segments，后端校验 + 批量创建。纯后端操作，不调 LLM。"""
    episode_id = parameters.get("episode_id")
    segments = parameters.get("segments") if isinstance(parameters.get("segments"), list) else []
    suggested_chars_raw = parameters.get("suggested_dialogue_chars")

    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    if not segments:
        return {"success": False, "error": "缺少必需字段: segments（LLM 必须先调 get_episode_script 规划分段方案）"}

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    script = str(episode.get("script") or "").strip()
    if not script:
        return {"success": False, "error": "剧本为空"}

    # 建议字数：优先用 LLM 传入值，否则从已有 plan 读取，否则默认 65
    suggested = 65
    if suggested_chars_raw is not None:
        try:
            suggested = int(suggested_chars_raw)
        except Exception:
            return {"success": False, "error": "suggested_dialogue_chars 必须是整数"}
    if suggested <= 0:
        return {"success": False, "error": "suggested_dialogue_chars 必须大于0"}

    # 校验
    validation = _validate_segments(script, segments)
    if not validation.get("ok"):
        return {
            "success": False,
            "error": validation.get("error", "分段校验未通过"),
            "notice": "请根据错误信息修正 segments 后重新调用。校验不通过时不创建分镜。"
        }

    # 校验通过 → 批量创建
    plan_id = str(uuid.uuid4())
    batch_result = _batch_create_storyboards_from_segments(project_id, episode_id, segments, plan_id)
    if not batch_result.get("success"):
        return {"success": False, "error": batch_result.get("error", "批量创建分镜失败")}

    # 存 plan
    plan_record = {
        "asset_id": plan_id,
        "episode_id": episode_id,
        "script_analysis": {
            "suggested_dialogue_chars_per_storyboard": suggested,
            "segments": segments,
            "batch_created": batch_result.get("created", []),
            "batch_count": batch_result.get("count", 0),
        },
        "created_at": datetime.now().isoformat(),
        "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
    }
    AssetService.save_asset(project_id, "storyboard_plan", plan_record)

    return {
        "success": True,
        "plan_id": plan_id,
        "batch_result": batch_result,
        "notice": f"已批量创建 {batch_result.get('count', 0)} 个分镜，可直接进入视频提示词生成阶段。"
    }
