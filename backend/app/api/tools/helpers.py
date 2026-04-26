"""工具公共辅助函数"""
import re
from typing import Optional, Dict
from app.services import AssetService


def check_asset_exists(project_id: str, asset_type: str, name: str) -> Optional[Dict]:
    """检查同名资产是否已存在"""
    existing_assets = AssetService.list_assets(project_id, asset_type)
    for asset in existing_assets:
        if asset.get("name") == name and not asset.get("parent_id"):
            return asset
    return None


def _resolve_episode_id(project_id: str, episode_id_input: str):
    """将 '第X集' 或 UUID 解析为实际 episode UUID。返回 (resolved_uuid, error_msg)。"""
    match = re.match(r'第(\d+)集', str(episode_id_input))
    if match:
        episode_number = int(match.group(1))
        episodes = AssetService.list_assets(project_id, "episode")
        for ep in episodes:
            if ep.get("episode_number") == episode_number:
                return ep["asset_id"], None
        return None, f"未找到第{episode_number}集"
    return episode_id_input, None


def validate_asset_refs(project_id: str, character_ids: list, scene_ids: list, prop_ids: list) -> Optional[str]:
    """校验分镜关联的资产ID是否存在且类型正确，返回错误信息或 None。"""
    for cid in (character_ids or []):
        if not cid:
            continue
        asset = AssetService.load_asset(project_id, "character", cid)
        if not asset:
            return f"character_ids 包含不存在的角色ID: {cid}（请确认该ID是角色资产）"
    for sid in (scene_ids or []):
        if not sid:
            continue
        asset = AssetService.load_asset(project_id, "scene", sid)
        if not asset:
            return f"scene_ids 包含不存在的场景ID: {sid}（请确认该ID是场景资产）"
    for pid in (prop_ids or []):
        if not pid:
            continue
        asset = AssetService.load_asset(project_id, "prop", pid)
        if not asset:
            return f"prop_ids 包含不存在的道具ID: {pid}（请确认该ID是道具资产）"
    return None


def _normalize_prompt_text(video_prompt) -> str:
    if isinstance(video_prompt, list):
        return "\n".join(str(x) for x in video_prompt if x is not None)
    if video_prompt is None:
        return ""
    return str(video_prompt)


def _normalize_dialogue_unit(text: str) -> str:
    s = str(text or "").strip()
    s = s.strip('"“”')
    return s


def count_dialogue_chars(units: list[str]) -> int:
    total = 0
    for u in units or []:
        normalized = _normalize_dialogue_unit(u)
        compact = "".join(normalized.split())
        total += len(compact)
    return total


def _contains_dialogue_in_prompt(video_prompt_text: str, unit: str, cursor: int) -> int:
    if not video_prompt_text or not unit:
        return cursor

    idx = video_prompt_text.find(unit, cursor)
    if idx >= 0:
        return idx + len(unit)

    simplified_text = (
        video_prompt_text
        .replace('"', "")
        .replace("“", "")
        .replace("”", "")
    )
    simplified_unit = (
        unit
        .replace('"', "")
        .replace("“", "")
        .replace("”", "")
    )
    idx2 = simplified_text.find(simplified_unit)
    if idx2 >= 0:
        return cursor

    return -1


SHORT_DIALOGUE_REASON_ENUM = {
    "REACTION_SHOT",         # 反应镜头为主
    "TIMECODE_CONSTRAINT",   # 剧本中有明确时长要求
    "SOURCE_TEXT_SHORT",     # 原始剧本文本本就很短
}


def _normalize_text_for_match(text: str) -> str:
    return "".join(str(text or "").split())


def _load_episode_script(project_id: str, episode_id: str) -> str:
    if not project_id or not episode_id:
        return ""
    episode = AssetService.load_asset(project_id, "episode", episode_id) or {}
    return str(episode.get("script") or episode.get("script_content") or "")


def _extract_storyboard_script_text(parameters: Dict, units: list[str]) -> str:
    description = str(parameters.get("description") or "").strip()
    if description:
        lines = description.splitlines()
        if len(lines) > 1:
            return "\n".join(lines[1:]).strip()
        return description
    return "\n".join(units)


def _extract_description_candidates(description: str) -> list[str]:
    raw = str(description or "").strip()
    if not raw:
        return []

    lines = [line.rstrip() for line in raw.splitlines() if line.strip()]
    if not lines:
        return []

    full_text = "\n".join(lines).strip()
    candidates = [full_text]

    if len(lines) > 1:
        body_text = "\n".join(lines[1:]).strip()
        if body_text:
            candidates.append(body_text)

    return [c for c in candidates if c]


def validate_storyboard_description_origin(project_id: str, episode_id: str, description: str) -> Dict:
    desc = str(description or "").strip()
    if not desc:
        return {"ok": False, "error": "description 不能为空，必须填写剧本原文片段"}

    script = _load_episode_script(project_id, str(episode_id or "").strip())
    script_norm = _normalize_text_for_match(script)
    if not script_norm:
        return {"ok": False, "error": "当前剧集缺少剧本文本，无法校验 description 是否为原文片段"}

    candidates = _extract_description_candidates(desc)
    if not candidates:
        return {"ok": False, "error": "description 不能为空，必须填写剧本原文片段"}

    for text in candidates:
        if _normalize_text_for_match(text) in script_norm:
            return {"ok": True}

    return {
        "ok": False,
        "error": "description 必须来自当前剧集剧本原文（允许首行简标，后续粘贴原文），禁止改写或摘要",
    }


def _has_time_literal(text: str) -> bool:
    if not text:
        return False
    patterns = [
        r"\d+\s*秒",
        r"\d+\s*分钟",
        r"\d{1,2}:\d{2}(?::\d{2})?",
    ]
    return any(re.search(p, text) for p in patterns)


def validate_declared_dialogue(project_id: str, parameters: Dict, min_exclusive: int = 40, max_exclusive: int = 90) -> Dict:
    units_raw = parameters.get("dialogue_units")
    declared = parameters.get("dialogue_chars_declared")
    short_reason = str(parameters.get("short_dialogue_reason") or "").strip()
    time_evidence = str(parameters.get("short_dialogue_time_evidence") or "").strip()

    if units_raw is None:
        return {"ok": False, "error": "缺少字段: dialogue_units"}
    if declared is None:
        return {"ok": False, "error": "缺少字段: dialogue_chars_declared"}
    if not isinstance(units_raw, list):
        return {"ok": False, "error": "dialogue_units 必须是字符串数组"}

    units: list[str] = []
    for item in units_raw:
        if not isinstance(item, str):
            return {"ok": False, "error": "dialogue_units 必须是字符串数组"}
        normalized = _normalize_dialogue_unit(item)
        if normalized:
            units.append(normalized)

    try:
        declared_count = int(declared)
    except Exception:
        return {"ok": False, "error": "dialogue_chars_declared 必须是整数"}

    actual_count = count_dialogue_chars(units)

    def _audit(status: str) -> Dict:
        return {
            "status": status,
            "dialogue_chars_declared": declared_count,
            "dialogue_chars_verified": actual_count,
            "reason_code": short_reason or None,
        }

    reason_valid = (not short_reason) or (short_reason in SHORT_DIALOGUE_REASON_ENUM)
    if not reason_valid:
        return {
            "ok": False,
            "error": f"short_dialogue_reason 非法，必须是枚举值: {', '.join(sorted(SHORT_DIALOGUE_REASON_ENUM))}",
            "audit": _audit("reason_invalid"),
        }

    if declared_count >= max_exclusive or actual_count >= max_exclusive:
        return {
            "ok": False,
            "error": f"对白字数必须小于{max_exclusive}，当前上报{declared_count}、校验{actual_count}",
            "audit": _audit("too_long"),
        }

    low_dialogue_suggested = declared_count <= min_exclusive or actual_count <= min_exclusive

    episode_id = str(parameters.get("episode_id") or "").strip()
    episode_script = _load_episode_script(project_id, episode_id)
    script_norm = _normalize_text_for_match(episode_script)

    if short_reason == "TIMECODE_CONSTRAINT":
        if not time_evidence:
            return {
                "ok": False,
                "error": "TIMECODE_CONSTRAINT 必须提供 short_dialogue_time_evidence（剧本中的时间数字原文）",
                "audit": _audit("time_evidence_missing"),
            }
        if not _has_time_literal(time_evidence):
            return {
                "ok": False,
                "error": "short_dialogue_time_evidence 必须包含明确时间数字（如3秒、15秒、00:12-00:15）",
                "audit": _audit("time_evidence_invalid"),
            }
        if not script_norm:
            return {
                "ok": False,
                "error": "short_dialogue_time_evidence 未在本集剧本中反查命中",
                "audit": _audit("time_evidence_not_found"),
            }

        evidence_candidates = [seg.strip() for seg in re.split(r"[、，,；;\n]+", time_evidence) if seg.strip()]
        evidence_candidates = [seg for seg in evidence_candidates if _has_time_literal(seg)]
        if not evidence_candidates:
            evidence_candidates = [time_evidence.strip()]

        matched = any(_normalize_text_for_match(seg) in script_norm for seg in evidence_candidates)
        if not matched:
            return {
                "ok": False,
                "error": "short_dialogue_time_evidence 未在本集剧本中反查命中",
                "audit": _audit("time_evidence_not_found"),
            }

    prompt_text = _normalize_prompt_text(parameters.get("video_prompt"))
    if prompt_text and units:
        cursor = 0
        for idx, unit in enumerate(units):
            next_cursor = _contains_dialogue_in_prompt(prompt_text, unit, cursor)
            if next_cursor < 0:
                return {
                    "ok": False,
                    "error": f"上报对白与 video_prompt 不匹配（第{idx + 1}条未找到）",
                    "audit": _audit("content_mismatch"),
                }
            cursor = next_cursor

    audit = _audit("ok")
    if low_dialogue_suggested:
        audit["warning"] = f"对白字数低于建议值（>{min_exclusive}），建议补充或填写 short_dialogue_reason"
        audit["low_dialogue_suggested"] = True
    return {"ok": True, "audit": audit}


KEY_ALIASES = {
    "分镜编辑": "storyboard_image_edit",
    "图生图": "storyboard_image_edit",
    "分镜图生图": "storyboard_image_edit",
    "分镜图": "storyboard_image",
    "分镜生图": "storyboard_image",
    "文生图分镜": "storyboard_image",
    "分镜格": "storyboard",
    "拆分分镜": "storyboard",
    "AI生成分镜": "storyboard",
    "视频": "video",
    "视频生成": "video",
    "图片": "image",
    "图片生成": "image",
    "九宫格": "nine_grid_combined_prompts",
    "三宫格": "triple_grid",
    "分镜描述": "storyboard_desc",
}
