"""生成工具执行逻辑"""
from datetime import datetime
import asyncio
import re
import uuid
from typing import Dict, Optional, Tuple, List, Any
import logging
import json
from app.services import AssetService, ProjectService, get_ai_service
from app.models.project import normalize_global_style_config

logger = logging.getLogger(__name__)


def _extract_generated_asset_lines(prompt_text: str) -> List[str]:
    if not prompt_text:
        return []

    lines = prompt_text.splitlines()
    started = False
    collected: List[str] = []

    for raw in lines:
        line = raw.strip()
        if not started:
            if line.lower().startswith("[asset definitions]"):
                started = True
            continue

        if not line:
            continue

        if line.startswith("[") and not line.startswith("@图"):
            break

        if line.startswith("@图") or line.startswith("图"):
            collected.append(line)
            continue

        if collected:
            break

    return collected


def _compact_asset_line(s: str) -> str:
    return "".join(str(s or "").split()).replace("（", "(").replace("）", ")")


def _strip_markdown_fence(text: str) -> str:
    """去除 LLM 输出的 markdown 代码块包裹（```...```）"""
    import re
    text = text.strip()
    text = re.sub(r'^```[\w-]*\s*\n?', '', text)
    text = re.sub(r'\n?```\s*$', '', text)
    return text.strip()


def _extract_json_object_from_text(text: str) -> Dict[str, Any]:
    """从 LLM 输出中提取 JSON 对象。"""
    cleaned = _strip_markdown_fence(text or "")
    try:
        data = json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end < start:
            raise ValueError("未找到 JSON 对象")
        data = json.loads(cleaned[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("LLM 返回不是 JSON 对象")
    return data


def _build_expected_asset_lines(characters: List[Dict[str, Any]], scenes: List[Dict[str, Any]], props: List[Dict[str, Any]]) -> List[str]:
    expected: List[str] = []
    idx = 1

    for char in characters:
        expected.append(f"@图{idx} ({char.get('name', '')})")
        idx += 1
    for scene in scenes:
        expected.append(f"@图{idx} ({scene.get('name', '')})")
        idx += 1
    for prop in props:
        expected.append(f"@图{idx} ({prop.get('name', '')})")
        idx += 1

    return expected


def _build_ordered_assets(project_id: str, character_ids: List[str], scene_ids: List[str], prop_ids: List[str]) -> Dict[str, Any]:
    ordered_characters: List[Dict[str, Any]] = []
    ordered_scenes: List[Dict[str, Any]] = []
    ordered_props: List[Dict[str, Any]] = []

    for cid in character_ids or []:
        char = AssetService.load_asset(project_id, "character", cid)
        if char:
            ordered_characters.append(char)

    for sid in scene_ids or []:
        scene = AssetService.load_asset(project_id, "scene", sid)
        if scene:
            ordered_scenes.append(scene)

    for pid in prop_ids or []:
        prop = AssetService.load_asset(project_id, "prop", pid)
        if prop:
            ordered_props.append(prop)

    assets_lines: List[str] = []
    img_idx = 1
    for char in ordered_characters:
        assets_lines.append(f"图{img_idx}（角色）：{char.get('name', '')} - {char.get('description', '')}")
        img_idx += 1
    for scene in ordered_scenes:
        assets_lines.append(f"图{img_idx}（场景）：{scene.get('name', '')} - {scene.get('description', '')}")
        img_idx += 1
    for prop in ordered_props:
        assets_lines.append(f"图{img_idx}（道具）：{prop.get('name', '')} - {prop.get('description', '')}")
        img_idx += 1

    audio_lines: List[str] = []
    audio_idx = 1
    for char in ordered_characters:
        if char.get("voice_enabled", True) and char.get("voice_audio_id"):
            audio_lines.append(f"@音频{audio_idx}是{char.get('name', '')}的声音")
            audio_idx += 1

    expected_asset_lines = _build_expected_asset_lines(ordered_characters, ordered_scenes, ordered_props)

    return {
        "characters": ordered_characters,
        "scenes": ordered_scenes,
        "props": ordered_props,
        "assets_desc": "\n".join(assets_lines) if assets_lines else "（无参考资产）",
        "audios_desc": "，".join(audio_lines) if audio_lines else "",
        "expected_asset_lines": expected_asset_lines,
    }


def _evaluate_asset_order(prompt_text: str, expected_lines: List[str]) -> Dict[str, Any]:
    actual_lines = _extract_generated_asset_lines(prompt_text)
    expected_compact = [_compact_asset_line(x) for x in expected_lines]
    actual_compact = [_compact_asset_line(x) for x in actual_lines]

    # 无资产时视为通过
    if not expected_lines:
        return {
            "status": "ok",
            "expected": expected_lines,
            "actual": actual_lines,
            "expected_compact": expected_compact,
            "actual_compact": actual_compact,
            "mismatches": [],
            "message": "无资产需要校验",
        }

    strict_match = expected_compact == actual_compact
    mismatch_count = max(len(expected_compact), len(actual_compact))
    mismatches: List[Dict[str, Any]] = []
    for i in range(mismatch_count):
        expected_item = expected_lines[i] if i < len(expected_lines) else ""
        actual_item = actual_lines[i] if i < len(actual_lines) else ""
        if _compact_asset_line(expected_item) != _compact_asset_line(actual_item):
            mismatches.append({
                "index": i,
                "expected": expected_item,
                "actual": actual_item,
            })

    return {
        "status": "ok" if strict_match else "mismatch",
        "expected": expected_lines,
        "actual": actual_lines,
        "expected_compact": expected_compact,
        "actual_compact": actual_compact,
        "mismatches": mismatches,
        "message": "asset definitions 顺序已校验" if strict_match else "asset definitions 顺序不一致，请按 expected 顺序使用 @图N",
    }


def _split_reverse_segments_text(text: str) -> List[str]:
    """把用户编辑的大文本按 [Segment] 边界切回字符串数组。"""
    raw = str(text or "").strip()
    if not raw:
        return []
    parts = re.split(r"\n\s*(?=\[Segment\])", raw)
    return [p.strip() for p in parts if p.strip()]


def _parse_reverse_segment_meta(segment_prompt: str, sequence: int, max_duration: int = 15) -> Dict[str, Any]:
    title = f"视频反推分段 {sequence}"
    first_line = next((line.strip() for line in str(segment_prompt or "").splitlines() if line.strip()), "")
    if first_line.startswith("[Segment]"):
        title = first_line.replace("[Segment]", "", 1).strip() or title

    time_range = ""
    duration = max_duration
    m = re.search(r"时间范围[:：]\s*([^\n\r]+)", segment_prompt or "")
    if m:
        time_range = m.group(1).strip()
        tm = re.search(r"(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})", time_range)
        if tm:
            def to_seconds(value: str) -> int:
                pieces = [int(x) for x in value.split(":")]
                if len(pieces) == 2:
                    return pieces[0] * 60 + pieces[1]
                return pieces[0] * 3600 + pieces[1] * 60 + pieces[2]
            try:
                duration = max(1, min(max_duration, to_seconds(tm.group(2)) - to_seconds(tm.group(1))))
            except Exception:
                duration = max_duration

    return {"title": title, "time_range": time_range, "duration": duration}



def _extract_asset_definition_block(segment_prompt: str) -> str:
    lines = str(segment_prompt or "").splitlines()
    asset_idx = next((i for i, line in enumerate(lines) if line.strip().lower() == "[asset definitions]"), -1)
    if asset_idx < 0:
        return ""
    end_idx = len(lines)
    for i in range(asset_idx + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith("[") and not stripped.startswith("@图"):
            end_idx = i
            break
    return "\n".join(lines[asset_idx:end_idx]).strip()


def _build_reverse_asset_library(project_id: str) -> Dict[str, List[Dict[str, Any]]]:
    def compact(asset: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "asset_id": asset.get("asset_id"),
            "name": asset.get("name", ""),
            "aliases": asset.get("aliases", []),
            "description": asset.get("description", ""),
            "appearance": asset.get("appearance", ""),
            "personality": asset.get("personality", ""),
            "role": asset.get("role", ""),
        }
    return {
        "characters": [compact(a) for a in AssetService.list_assets(project_id, "character") or []],
        "scenes": [compact(a) for a in AssetService.list_assets(project_id, "scene") or []],
        "props": [compact(a) for a in AssetService.list_assets(project_id, "prop") or []],
    }


def _coerce_id_list(values: Any, allowed: set) -> List[str]:
    result: List[str] = []
    if not isinstance(values, list):
        return result
    for value in values:
        text = str(value or "").strip()
        if text in allowed and text not in result:
            result.append(text)
    return result


def _replace_asset_definition_lines(segment_prompt: str, expected_asset_lines: List[str]) -> str:
    lines = str(segment_prompt or "").splitlines()
    canonical = list(expected_asset_lines or [])
    if not lines:
        return segment_prompt

    asset_idx = next((i for i, line in enumerate(lines) if line.strip().lower() == "[asset definitions]"), -1)
    if asset_idx < 0:
        return "\n".join([lines[0], "[Asset Definitions]", *canonical, *lines[1:]])

    end_idx = len(lines)
    for i in range(asset_idx + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith("[") and not stripped.startswith("@图"):
            end_idx = i
            break

    body = lines[asset_idx + 1:end_idx]
    without_old_refs = [line for line in body if not line.strip().startswith("@图") and not line.strip().startswith("图")]
    replacement = canonical + without_old_refs
    return "\n".join(lines[:asset_idx + 1] + replacement + lines[end_idx:])


async def _adopt_reverse_segment_prompt_with_llm(
    project_id: str,
    llm: Any,
    segment_prompt: str,
    sequence: int,
    screenplay_text: str,
    asset_library: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    from app.services import ProjectService
    from app.models.duration_config import get_storyboard_duration_config
    _proj = ProjectService.get_project(project_id)
    _max_duration = get_storyboard_duration_config((_proj or {}).get("ai_config"))["duration_seconds"]
    meta = _parse_reverse_segment_meta(segment_prompt, sequence, max_duration=_max_duration)
    allowed_character_ids = {a.get("asset_id") for a in asset_library.get("characters", []) if a.get("asset_id")}
    allowed_scene_ids = {a.get("asset_id") for a in asset_library.get("scenes", []) if a.get("asset_id")}
    allowed_prop_ids = {a.get("asset_id") for a in asset_library.get("props", []) if a.get("asset_id")}

    prompt = f"""你是已有视频生成提示词的资产匹配子代理，不是提示词重写器。

任务：只根据当前 segment_prompt、全剧本和项目资产库，完成资产匹配、剧本分段原文提取、@图N 引用规范化建议。必须输出纯 JSON 对象，不要 markdown，不要解释。

硬性规则：
1. 不得改写 segment_prompt 主体内容，包括 Shot、主体动作、物理细节、镜头语言、光影、[Native Audio]、SFX、Dialogue、严禁字幕/BGM 等。
2. 只允许为 [Asset Definitions] 开头部分匹配资产引用；真正的 @图N 行会由后端按资产顺序生成。
3. description 必须是该 segment 对应的剧本分段原文/动作对白片段，不是标题，不是摘要。可从全剧本和 segment_prompt 的 Dialogue/时间范围综合提取；无法精确定位时，输出与本 segment 内容最贴近的剧本原文片段。
4. character_ids、scene_ids、prop_ids 必须只从资产库中选择真实 asset_id，严禁编造。
5. 人物匹配要考虑称呼、身份、关系、台词、服装和行为。例如“林太太/紫衣贵妇/主家”可能匹配同一角色资产；“大小姐/林清”、“娇娇/林娇”、“佣人/张妈”等也要结合资产库判断。
6. 如果没有可信匹配，返回空数组，并在 warnings 说明原因。

当前 sequence: {sequence}
当前标题: {meta.get('title')}
当前时间范围: {meta.get('time_range')}

[SEGMENT_PROMPT]
{segment_prompt}

[ASSET_DEFINITIONS_BLOCK]
{_extract_asset_definition_block(segment_prompt)}

[FULL_SCREENPLAY]
{screenplay_text}

[PROJECT_ASSETS]
{json.dumps(asset_library, ensure_ascii=False)}

输出 JSON 格式：
{{
  "sequence": {sequence},
  "description": "该 segment 对应的剧本分段原文，包含动作和对白",
  "character_ids": ["真实角色asset_id"],
  "scene_ids": ["真实场景asset_id"],
  "prop_ids": ["真实道具asset_id"],
  "warnings": []
}}
"""
    llm_result = await llm.chat([{"role": "user", "content": prompt}])
    parsed = _extract_json_object_from_text(llm_result.get("content", "") or "")

    character_ids = _coerce_id_list(parsed.get("character_ids"), allowed_character_ids)
    scene_ids = _coerce_id_list(parsed.get("scene_ids"), allowed_scene_ids)
    prop_ids = _coerce_id_list(parsed.get("prop_ids"), allowed_prop_ids)
    ordered_assets = _build_ordered_assets(project_id, character_ids, scene_ids, prop_ids)
    normalized_prompt = _replace_asset_definition_lines(segment_prompt, ordered_assets["expected_asset_lines"])
    asset_guard = _evaluate_asset_order(normalized_prompt, ordered_assets["expected_asset_lines"])

    return {
        "success": asset_guard.get("status") == "ok",
        "sequence": sequence,
        "title": meta["title"],
        "time_range": meta["time_range"],
        "duration": meta["duration"],
        "description": str(parsed.get("description") or "").strip() or segment_prompt,
        "normalized_video_prompt": normalized_prompt,
        "character_ids": character_ids,
        "scene_ids": scene_ids,
        "prop_ids": prop_ids,
        "warnings": parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else [],
        "asset_order_guard": asset_guard,
        "ordered_assets": ordered_assets,
    }


async def handle_generate_asset_image(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    try:
        from app.api.generation.image import generate_image_core
        from app.api.generation.utils import check_project_budget, check_user_credit_limit
        from app.core.context import get_current_user
        from app.core.pricing import DEFAULT_IMAGE_COST
        from app.services import ProjectService
        asset_type = parameters.get("asset_type")
        asset_id = parameters.get("asset_id")
        if not asset_type or not asset_id:
            return {"success": False, "error": "asset_type 和 asset_id 为必填项"}
        asset = AssetService.load_asset(project_id, asset_type, asset_id)
        if not asset:
            return {"success": False, "error": f"资产不存在: {asset_type}/{asset_id}"}
        image_prompt = asset.get("image_prompt", "")
        if not image_prompt:
            return {"success": False, "error": f"资产 {asset.get('name', asset_id)} 尚未设置 image_prompt，请先编写生图提示词"}
        proj = ProjectService.get_project(project_id)
        check_project_budget(proj)
        check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST)
        saved = await generate_image_core(project_id=project_id, asset_id=asset_id, asset_type=asset_type, prompt=image_prompt, ai_config=ai_config)
        return {"success": True, "image_id": saved["image_id"], "asset_name": asset.get("name", asset_id)}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_generate_all_asset_images(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    try:
        from app.api.generation.image import generate_image_core
        from app.api.generation.utils import check_project_budget, check_user_credit_limit
        from app.core.context import get_current_user
        from app.core.pricing import DEFAULT_IMAGE_COST
        from app.services import ProjectService
        import asyncio
        asset_types = parameters.get("asset_types", ["character", "scene", "prop"])

        tasks = []
        for atype in asset_types:
            for asset in (AssetService.list_assets(project_id, atype) or []):
                if asset.get("image_prompt"):
                    tasks.append((asset, atype))

        if not tasks:
            return {"success": True, "generated": 0, "skipped": 0, "details": [], "skipped_names": []}

        proj = ProjectService.get_project(project_id)
        check_project_budget(proj)
        check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST * len(tasks))

        async def gen_one(asset, atype):
            aid = asset.get("asset_id")
            try:
                saved = await generate_image_core(project_id=project_id, asset_id=aid, asset_type=atype, prompt=asset["image_prompt"], ai_config=ai_config)
                return {"ok": True, "name": asset.get("name", aid), "image_id": saved["image_id"]}
            except Exception as e:
                return {"ok": False, "name": f"{asset.get('name', aid)}(错误: {str(e)})"}

        # 收集无提示词的资产
        skipped_names = [asset.get("name", asset.get("asset_id")) for atype in asset_types for asset in (AssetService.list_assets(project_id, atype) or []) if not asset.get("image_prompt")]

        outcomes = await asyncio.gather(*[gen_one(asset, atype) for asset, atype in tasks])
        results = [o for o in outcomes if o["ok"]]
        skipped_names += [o["name"] for o in outcomes if not o["ok"]]

        return {"success": True, "generated": len(results), "skipped": len(skipped_names), "details": results, "skipped_names": skipped_names}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_generate_storyboard_image(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.api.generation.image import edit_image
        from app.api.generation.models import ImageEditRequest
        storyboard_id = parameters.get("storyboard_id")
        if not storyboard_id:
            return {"success": False, "error": "storyboard_id 为必填项"}
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            return {"success": False, "error": f"分镜不存在: {storyboard_id}"}
        image_prompt = storyboard.get("image_prompt", "")
        if not image_prompt:
            return {"success": False, "error": f"分镜 {storyboard.get('sequence', storyboard_id)} 尚未设置 image_prompt"}
        ref_ids = []
        for char_id in storyboard.get("character_ids", []):
            char = AssetService.load_asset(project_id, "character", char_id)
            if char and char.get("image_id"): ref_ids.append(char["image_id"])
        for scene_id in (storyboard.get("scene_ids") or ([storyboard["scene_id"]] if storyboard.get("scene_id") else [])):
            scene = AssetService.load_asset(project_id, "scene", scene_id)
            if scene and scene.get("image_id"): ref_ids.append(scene["image_id"])
        if not ref_ids:
            return {"success": False, "error": "分镜关联的角色/场景均无主图，请先为资产生图"}
        req = ImageEditRequest(asset_id=storyboard_id, asset_type="storyboard", prompt=image_prompt, reference_image_ids=ref_ids)
        saved = await edit_image(project_id=project_id, request=req)
        return {"success": True, "image_id": saved["image_id"], "storyboard_sequence": storyboard.get("sequence")}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def _generate_storyboard_video_prompt_subagent_single(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    """独立子代：为单个分镜生成并保存 video_prompt 或 image_prompt，附带资产顺序拦截与自动重试。"""
    try:
        from app.services import ProjectService, get_ai_service
        from app.api.generation.template_helpers import get_active_template
        from app.api.generation.style_presets import get_video_style_suffix, get_image_style_suffix

        storyboard_id = parameters.get("storyboard_id")
        if not storyboard_id:
            return {"success": False, "error": "storyboard_id 为必填项"}

        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            return {"success": False, "error": f"分镜不存在: {storyboard_id}"}

        project = ProjectService.get_project(project_id)
        if not project:
            return {"success": False, "error": "项目不存在"}

        project_ai_config = ai_config or project.get("ai_config", {})
        llm = get_ai_service(project_ai_config, "llm", project_id)
        prompt_type = parameters.get("prompt_type", "video")
        mode = parameters.get("mode", "generate")

        if prompt_type == "video" and mode == "adopt_reverse":
            episode = AssetService.load_asset(project_id, "episode", storyboard.get("episode_id", "")) if storyboard.get("episode_id") else None
            segment_prompt = str(storyboard.get("video_prompt") or storyboard.get("raw_video_prompt") or "").strip()
            if not segment_prompt:
                await llm.close()
                return {"success": False, "error": "分镜缺少反推 segment prompt，无法采用已有提示词"}

            asset_library = _build_reverse_asset_library(project_id)
            screenplay_text = str(
                (episode or {}).get("video_reverse_screenplay")
                or (episode or {}).get("video_reverse_screenplay_text")
                or (episode or {}).get("script")
                or ""
            )
            result = await _adopt_reverse_segment_prompt_with_llm(
                project_id,
                llm,
                segment_prompt,
                int(storyboard.get("sequence") or 1),
                screenplay_text,
                asset_library,
            )
            if not result.get("success"):
                await llm.close()
                return {
                    "success": False,
                    "error": "反推提示词资产匹配/引用规范化失败",
                    "storyboard_id": storyboard_id,
                    **result,
                }

            storyboard["description"] = result.get("description") or storyboard.get("description", "")
            storyboard["video_prompt"] = result.get("normalized_video_prompt") or segment_prompt
            storyboard["character_ids"] = result.get("character_ids", [])
            storyboard["scene_ids"] = result.get("scene_ids", [])
            storyboard["prop_ids"] = result.get("prop_ids", [])
            storyboard["video_reverse_time_range"] = result.get("time_range", storyboard.get("video_reverse_time_range", ""))
            storyboard["asset_order_guard"] = result.get("asset_order_guard")
            storyboard["updated_at"] = datetime.now().isoformat()
            AssetService.save_asset(project_id, "storyboard", storyboard)
            await llm.close()
            return {
                "success": True,
                "storyboard_id": storyboard_id,
                "sequence": storyboard.get("sequence"),
                "mode": "adopt_reverse",
                "description": storyboard.get("description"),
                "character_ids": storyboard.get("character_ids", []),
                "scene_ids": storyboard.get("scene_ids", []),
                "prop_ids": storyboard.get("prop_ids", []),
                "video_prompt": storyboard.get("video_prompt", ""),
                "asset_order_guard": result.get("asset_order_guard"),
                "warnings": result.get("warnings", []),
                "saved": True,
            }

        # ── 图片提示词分支 ──────────────────────────────────────────────
        if prompt_type == "image":
            global_style_config = normalize_global_style_config(project_ai_config.get("global_style_config"))
            language = global_style_config.get("prompt_language", "zh")
            image_style = global_style_config.get("image_style", {})
            style_suffix = ""
            if image_style.get("enabled", True):
                preset_id = image_style.get("preset_id", "none")
                if preset_id == "custom":
                    style_suffix = image_style.get("custom_suffix", "")
                elif preset_id != "none":
                    style_suffix = get_image_style_suffix(preset_id, language)

            custom_template = get_active_template(project_ai_config, "storyboard_image_edit")

            from app.services.global_prompt_service import get_prompt_content

            episode = AssetService.load_asset(project_id, "episode", storyboard.get("episode_id", "")) if storyboard.get("episode_id") else None
            script_content = (episode or {}).get("script", "")

            # 构建角色/场景/道具信息文本
            character_ids = storyboard.get("character_ids") or []
            scene_ids = storyboard.get("scene_ids") or ([storyboard["scene_id"]] if storyboard.get("scene_id") else [])
            prop_ids = storyboard.get("prop_ids") or []
            ordered_assets = _build_ordered_assets(project_id, character_ids, scene_ids, prop_ids)

            user_request = parameters.get("user_request", "") or ""

            user_prompt = (
                "你是图片提示词生成器。请从零生成，不要参考已有的提示词内容。\n\n"
                f"## 用户要求\n{user_request or '全新生成 image_prompt'}\n\n"
                "## 全局风格配置\n"
                f"语言：{language}\n"
                f"图片风格：{style_suffix or '默认'}\n\n"
                "## 图片提示词模板（必须遵循）\n"
                f"{custom_template or get_prompt_content('storyboard_image_edit', project_ai_config) or ''}\n\n"
                "## 当前集完整剧本\n"
                f"{script_content or '（无剧本）'}\n\n"
                "## 当前分镜数据\n"
                f"序号：{storyboard.get('sequence')}\n"
                f"描述：{storyboard.get('description', '')}\n"
                f"对白：{storyboard.get('dialogue', '')}\n\n"
                "## 分镜关联资产\n"
                f"{ordered_assets['assets_desc']}\n\n"
                "现在直接输出最终 image_prompt。"
            )

            llm_result = await llm.chat([{"role": "user", "content": user_prompt}])
            final_prompt = _strip_markdown_fence(llm_result.get("content", "") or "")

            storyboard["image_prompt"] = final_prompt
            storyboard["updated_at"] = datetime.now().isoformat()
            AssetService.save_asset(project_id, "storyboard", storyboard)

            await llm.close()
            return {
                "success": True,
                "storyboard_id": storyboard_id,
                "sequence": storyboard.get("sequence"),
                "prompt_type": "image",
                "image_prompt": final_prompt,
                "ordered_assets": {
                    "expected_asset_lines": ordered_assets["expected_asset_lines"],
                    "assets_desc": ordered_assets["assets_desc"],
                    "audios_desc": ordered_assets["audios_desc"],
                },
                "saved": True,
            }

        # ── 视频提示词分支（原有逻辑）──────────────────────────────────
        # 统一来源：以分镜已保存资产顺序为准；缺失时允许参数覆盖
        character_ids = storyboard.get("character_ids") or parameters.get("character_ids") or []
        scene_ids = storyboard.get("scene_ids") or ([storyboard["scene_id"]] if storyboard.get("scene_id") else [])
        if not scene_ids and parameters.get("scene_ids"):
            scene_ids = parameters.get("scene_ids") or []
        if not scene_ids and parameters.get("scene"):
            scene_ids = [parameters.get("scene")]
        prop_ids = storyboard.get("prop_ids") or parameters.get("prop_ids") or []

        ordered_assets = _build_ordered_assets(project_id, character_ids, scene_ids, prop_ids)

        global_style_config = normalize_global_style_config(project_ai_config.get("global_style_config"))
        language = global_style_config.get("prompt_language", "zh")
        video_style = global_style_config.get("video_style", {})
        style_suffix = ""
        if video_style.get("enabled", True):
            preset_id = video_style.get("preset_id", "none")
            if preset_id == "custom":
                style_suffix = video_style.get("custom_suffix", "")
            elif preset_id != "none":
                style_suffix = get_video_style_suffix(preset_id, language)

        custom_template = get_active_template(project_ai_config, "video")

        from app.services.global_prompt_service import get_prompt_content

        episode = AssetService.load_asset(project_id, "episode", storyboard.get("episode_id", "")) if storyboard.get("episode_id") else None
        script_content = (episode or {}).get("script", "")

        global_style_context = {
            "prompt_language": language,
            "video_style": video_style,
            "style_suffix": style_suffix,
        }

        request_payload = {
            "storyboard_id": storyboard_id,
            "storyboard_description": parameters.get("storyboard_description") or storyboard.get("description", ""),
            "dialogue": parameters.get("dialogue") or storyboard.get("dialogue", ""),
            "action": parameters.get("action") or storyboard.get("action", ""),
            "shot_type": parameters.get("shot_type") or storyboard.get("shot_type", ""),
            "camera_angle": parameters.get("camera_angle") or storyboard.get("camera_angle", ""),
            "duration": int(parameters.get("duration") or storyboard.get("duration") or 6),
            "character_ids": character_ids,
            "scene_ids": scene_ids,
            "prop_ids": prop_ids,
        }

        storyboard_context = {
            "sequence": storyboard.get("sequence"),
            "asset_id": storyboard.get("asset_id"),
            "episode_id": storyboard.get("episode_id"),
            "description": request_payload["storyboard_description"],
            "dialogue": request_payload["dialogue"],
            "action": request_payload["action"],
            "shot_type": request_payload["shot_type"],
            "camera_angle": request_payload["camera_angle"],
            "duration": request_payload["duration"],
        }

        expected_asset_lines = ordered_assets["expected_asset_lines"]
        canonical_asset_lines = "\n".join(expected_asset_lines)
        from app.services.global_prompt_service import get_prompt_content
        from app.models.duration_config import get_storyboard_duration_config, render_duration_template
        _duration_cfg = get_storyboard_duration_config(project_ai_config)
        contract_template = get_prompt_content("video_subagent_contract", project_ai_config)
        if not contract_template:
            await llm.close()
            return {"success": False, "error": "缺少提示词模板: video_subagent_contract"}

        rendered_contract = contract_template.format(canonical_asset_lines=canonical_asset_lines)
        if "【RETRY_INSTRUCTION】" in rendered_contract:
            base_part, retry_part = rendered_contract.split("【RETRY_INSTRUCTION】", 1)
        else:
            base_part, retry_part = rendered_contract, ""
        output_contract = base_part.replace("【BASE_CONTRACT】", "").strip()
        retry_instruction_from_template = retry_part.strip()

        user_request = parameters.get("user_request", "") or ""

        def build_subagent_user_prompt(extra_instruction: str = "") -> str:
            return (
                "你是视频提示词生成器。请从零生成，不要参考已有的提示词内容。\n\n"
                f"## 用户要求\n{user_request or '全新生成 video_prompt'}\n\n"
                f"{output_contract}\n"
                f"{(extra_instruction or '').strip()}\n\n"
                "## 全局风格配置\n"
                f"{json.dumps(global_style_context, ensure_ascii=False, indent=2)}\n\n"
                "## 当前集完整剧本\n"
                f"{script_content or '（无剧本）'}\n\n"
                "## 视频提示词模板（必须遵循）\n"
                f"{render_duration_template(custom_template or get_prompt_content('video', project_ai_config) or '', _duration_cfg['duration_seconds'], _duration_cfg['dialogue_chars_max'])}\n\n"
                "## 当前分镜完整数据\n"
                f"{json.dumps(storyboard_context, ensure_ascii=False, indent=2)}\n\n"
                "## 分镜引用资产完整信息\n"
                f"{ordered_assets['assets_desc']}\n"
                f"{('音频：' + ordered_assets['audios_desc']) if ordered_assets['audios_desc'] else ''}\n\n"
                "## [CANONICAL_ASSET_LINES]（必须逐字复制到 [Asset Definitions]）\n"
                f"{canonical_asset_lines}\n\n"
                "现在直接输出最终 video_prompt。"
            )

        attempts: List[Dict[str, Any]] = []
        final_prompt = ""
        final_guard: Dict[str, Any] = {}

        extra_retry_instruction = retry_instruction_from_template

        first_user_prompt = build_subagent_user_prompt()
        first_llm_result = await llm.chat([{"role": "user", "content": first_user_prompt}])
        first_prompt = _strip_markdown_fence(first_llm_result.get("content", "") or "")

        first_guard = _evaluate_asset_order(first_prompt, expected_asset_lines)
        logger.info(
            "[subagent_debug] storyboard_id=%s attempt=1 guard_status=%s expected=%s actual=%s",
            storyboard_id,
            first_guard.get("status"),
            first_guard.get("expected"),
            first_guard.get("actual"),
        )
        attempts.append({
            "attempt": 1,
            "prompt": first_prompt,
            "prompt_preview": (first_prompt or "")[:500],
            "model_raw_content_preview": (first_llm_result.get("content", "") or "")[:500],
            "subagent_user_prompt_preview": first_user_prompt[:800],
            "asset_order_guard": {
                "enabled": True,
                **first_guard,
            },
            "retry_enhanced": False,
        })

        if first_guard["status"] == "ok":
            final_prompt = first_prompt
            final_guard = first_guard
        else:
            retry_user_prompt = build_subagent_user_prompt(extra_retry_instruction)
            second_llm_result = await llm.chat([{"role": "user", "content": retry_user_prompt}])
            second_prompt = _strip_markdown_fence(second_llm_result.get("content", "") or "")

            second_guard = _evaluate_asset_order(second_prompt, expected_asset_lines)
            logger.info(
                "[subagent_debug] storyboard_id=%s attempt=2 guard_status=%s expected=%s actual=%s",
                storyboard_id,
                second_guard.get("status"),
                second_guard.get("expected"),
                second_guard.get("actual"),
            )
            attempts.append({
                "attempt": 2,
                "prompt": second_prompt,
                "prompt_preview": (second_prompt or "")[:500],
                "model_raw_content_preview": (second_llm_result.get("content", "") or "")[:500],
                "subagent_user_prompt_preview": retry_user_prompt[:800],
                "asset_order_guard": {
                    "enabled": True,
                    **second_guard,
                },
                "retry_enhanced": True,
                "retry_instruction": extra_retry_instruction,
            })

            final_prompt = second_prompt
            final_guard = second_guard

        if final_guard.get("status") != "ok":
            await llm.close()
            return {
                "success": False,
                "error": "视频提示词资产顺序校验失败：@图N 顺序与分镜资产顺序不一致",
                "storyboard_id": storyboard_id,
                "sequence": storyboard.get("sequence"),
                "request": request_payload,
                "ordered_assets": {
                    "expected_asset_lines": expected_asset_lines,
                    "assets_desc": ordered_assets["assets_desc"],
                    "audios_desc": ordered_assets["audios_desc"],
                },
                "asset_order_guard": {
                    "enabled": True,
                    **final_guard,
                },
                "attempt_count": len(attempts),
                "attempts": attempts,
            }

        storyboard["video_prompt"] = final_prompt
        storyboard["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "storyboard", storyboard)

        await llm.close()
        return {
            "success": True,
            "storyboard_id": storyboard_id,
            "sequence": storyboard.get("sequence"),
            "request": request_payload,
            "ordered_assets": {
                "expected_asset_lines": expected_asset_lines,
                "assets_desc": ordered_assets["assets_desc"],
                "audios_desc": ordered_assets["audios_desc"],
            },
            "video_prompt": final_prompt,
            "asset_order_guard": {
                "enabled": True,
                **final_guard,
            },
            "attempt_count": len(attempts),
            "attempts": attempts,
            "saved": True,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}



async def handle_import_reverse_segments(project_id: str, parameters: Dict) -> Dict:
    """把 video_reverse_segments 字符串数组导入为分镜骨架；不做删除确认、不调用 LLM、不做资产匹配。"""
    episode_id = parameters.get("episode_id")
    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    raw_segments = episode.get("video_reverse_segments") or []
    if isinstance(raw_segments, str):
        segment_prompts = _split_reverse_segments_text(raw_segments)
    elif isinstance(raw_segments, list):
        segment_prompts = [str(item).strip() for item in raw_segments if isinstance(item, str) and item.strip()]
    else:
        segment_prompts = []

    if not segment_prompts:
        text = episode.get("video_reverse_segment_prompts_text") or ""
        segment_prompts = _split_reverse_segments_text(text)

    if not segment_prompts:
        return {"success": False, "error": "未找到 video_reverse_segments 字符串数组，请先完成视频反推分段提示词。"}

    created = []
    storyboard_ids = []
    now = datetime.now().isoformat()
    from app.services import ProjectService
    from app.models.duration_config import get_storyboard_duration_config
    _proj = ProjectService.get_project(project_id)
    _max_duration = get_storyboard_duration_config((_proj or {}).get("ai_config"))["duration_seconds"]
    for index, segment_prompt in enumerate(segment_prompts):
        meta = _parse_reverse_segment_meta(segment_prompt, index + 1, max_duration=_max_duration)
        storyboard = {
            "asset_id": str(uuid.uuid4()),
            "episode_id": episode_id,
            "sequence": index + 1,
            "description": "",
            "script_scene_label": meta.get("title", ""),
            "video_prompt": segment_prompt,
            "raw_video_prompt": segment_prompt,
            "duration": meta.get("duration") or _max_duration,
            "character_ids": [],
            "scene_ids": [],
            "prop_ids": [],
            "source": "video_reverse_segment_prompt",
            "video_reverse_time_range": meta.get("time_range", ""),
            "created_at": now,
            "updated_at": now,
        }
        saved = AssetService.save_asset(project_id, "storyboard", storyboard)
        storyboard_ids.append(saved["asset_id"])
        created.append({
            "storyboard_id": saved["asset_id"],
            "sequence": saved.get("sequence"),
            "title": meta.get("title"),
            "time_range": meta.get("time_range"),
            "duration": meta.get("duration"),
        })

    episode = AssetService.load_asset(project_id, "episode", episode_id) or episode
    existing_ids = list(episode.get("storyboard_ids", []) or [])
    episode["storyboard_ids"] = existing_ids + [sid for sid in storyboard_ids if sid not in existing_ids]
    episode["video_reverse_segments"] = segment_prompts
    episode["video_reverse_segment_prompts_text"] = "\n\n".join(segment_prompts)
    episode["updated_at"] = datetime.now().isoformat()
    AssetService.save_asset(project_id, "episode", episode)

    return {
        "success": True,
        "episode_id": episode_id,
        "count": len(created),
        "storyboards_created": len(created),
        "created": created,
        "message": f"已导入 {len(created)} 个视频反推分段为分镜骨架。请继续并发调用 generate_storyboard_video_prompt_subagent(mode=adopt_reverse)。",
    }


async def handle_create_storyboards_from_video_reverse_segments(project_id: str, parameters: Dict) -> Dict:
    """兼容旧工具名：转调用 import_reverse_segments，仅创建骨架。"""
    return await handle_import_reverse_segments(project_id, parameters)


async def handle_generate_storyboard_video_prompt_subagent(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    """独立子代：仅处理单个分镜（原子能力）。批量由主对话层发起多个并行调用。"""
    try:
        storyboard_id = parameters.get("storyboard_id")
        if not storyboard_id:
            return {"success": False, "error": "storyboard_id 为必填项（单次仅处理一个分镜）"}

        if parameters.get("storyboard_ids") or parameters.get("episode_id"):
            return {
                "success": False,
                "error": "该工具为单分镜原子工具：批量请让主代理同轮发起多个 storyboard_id 调用"
            }

        single_parameters = dict(parameters)
        single_parameters["storyboard_id"] = storyboard_id
        single_parameters.pop("storyboard_ids", None)
        single_parameters.pop("episode_id", None)

        return await _generate_storyboard_video_prompt_subagent_single(project_id, single_parameters, ai_config)
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_generate_storyboard_video(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.api.generation.video import generate_video
        from app.api.generation.models import VideoGenerateRequest
        storyboard_id = parameters.get("storyboard_id")
        if not storyboard_id:
            return {"success": False, "error": "storyboard_id 为必填项"}
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            return {"success": False, "error": f"分镜不存在: {storyboard_id}"}
        video_prompt = storyboard.get("video_prompt", "")
        if not video_prompt:
            return {"success": False, "error": f"分镜 {storyboard.get('sequence', storyboard_id)} 尚未设置 video_prompt"}
        ep_id = parameters.get("episode_id") or storyboard.get("episode_id", "")
        image_ids = []
        for char_id in storyboard.get("character_ids", []):
            char = AssetService.load_asset(project_id, "character", char_id)
            if char and char.get("image_id"): image_ids.append(char["image_id"])
        for scene_id in (storyboard.get("scene_ids") or ([storyboard["scene_id"]] if storyboard.get("scene_id") else [])):
            scene = AssetService.load_asset(project_id, "scene", scene_id)
            if scene and scene.get("image_id"): image_ids.append(scene["image_id"])
        for prop_id in storyboard.get("prop_ids", []):
            prop = AssetService.load_asset(project_id, "prop", prop_id)
            if prop and prop.get("image_id"): image_ids.append(prop["image_id"])
        if not image_ids:
            return {"success": False, "error": "分镜关联的角色/场景/道具均无主图，请先为资产生图"}
        req = VideoGenerateRequest(storyboard_id=storyboard_id, episode_id=ep_id, image_ids=image_ids, prompt=video_prompt, duration=storyboard.get("duration", 6), resolution=storyboard.get("resolution") or None, ratio=None)
        data = await generate_video(project_id=project_id, request=req)
        return {"success": True, "video_id": data.get("video_id"), "status": data.get("status"), "storyboard_sequence": storyboard.get("sequence")}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_generate_all_storyboard_images(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.api.generation.image import edit_image
        from app.api.generation.models import ImageEditRequest
        episode_id = parameters.get("episode_id")
        storyboards = AssetService.list_assets(project_id, "storyboard") or []
        if episode_id:
            storyboards = [s for s in storyboards if s.get("episode_id") == episode_id]
        results, skipped = [], []
        for sb in storyboards:
            sid = sb.get("asset_id")
            image_prompt = sb.get("image_prompt", "")
            if not image_prompt:
                skipped.append(f"第{sb.get('sequence', sid)}镜(无提示词)")
                continue
            try:
                ref_ids = []
                for char_id in sb.get("character_ids", []):
                    char = AssetService.load_asset(project_id, "character", char_id)
                    if char and char.get("image_id"): ref_ids.append(char["image_id"])
                for scene_id in (sb.get("scene_ids") or ([sb["scene_id"]] if sb.get("scene_id") else [])):
                    scene = AssetService.load_asset(project_id, "scene", scene_id)
                    if scene and scene.get("image_id"): ref_ids.append(scene["image_id"])
                if not ref_ids:
                    skipped.append(f"第{sb.get('sequence', sid)}镜(关联资产无主图)")
                    continue
                req = ImageEditRequest(asset_id=sid, asset_type="storyboard", prompt=image_prompt, reference_image_ids=ref_ids)
                saved = await edit_image(project_id=project_id, request=req)
                results.append({"sequence": sb.get("sequence"), "image_id": saved["image_id"]})
            except Exception as e:
                skipped.append(f"第{sb.get('sequence', sid)}镜(错误: {str(e)})")
        return {"success": True, "generated": len(results), "skipped": len(skipped), "skipped_names": skipped}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_generate_all_storyboard_videos(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.api.generation.video import generate_video
        from app.api.generation.models import VideoGenerateRequest
        episode_id = parameters.get("episode_id")
        storyboards = AssetService.list_assets(project_id, "storyboard") or []
        if episode_id:
            storyboards = [s for s in storyboards if s.get("episode_id") == episode_id]
        results, skipped = [], []
        for sb in storyboards:
            sid = sb.get("asset_id")
            video_prompt = sb.get("video_prompt", "")
            if not video_prompt:
                skipped.append(f"第{sb.get('sequence', sid)}镜(无视频提示词)")
                continue
            try:
                image_ids = []
                for char_id in sb.get("character_ids", []):
                    char = AssetService.load_asset(project_id, "character", char_id)
                    if char and char.get("image_id"): image_ids.append(char["image_id"])
                for scene_id in (sb.get("scene_ids") or ([sb["scene_id"]] if sb.get("scene_id") else [])):
                    scene = AssetService.load_asset(project_id, "scene", scene_id)
                    if scene and scene.get("image_id"): image_ids.append(scene["image_id"])
                for prop_id in sb.get("prop_ids", []):
                    prop = AssetService.load_asset(project_id, "prop", prop_id)
                    if prop and prop.get("image_id"): image_ids.append(prop["image_id"])
                if not image_ids:
                    skipped.append(f"第{sb.get('sequence', sid)}镜(关联资产无主图)")
                    continue
                ep_id = episode_id or sb.get("episode_id", "")
                req = VideoGenerateRequest(storyboard_id=sid, episode_id=ep_id, image_ids=image_ids, prompt=video_prompt, duration=sb.get("duration", 6), resolution=sb.get("resolution") or None, ratio=None)
                data = await generate_video(project_id=project_id, request=req)
                results.append({"sequence": sb.get("sequence"), "video_id": data.get("video_id")})
            except Exception as e:
                skipped.append(f"第{sb.get('sequence', sid)}镜(错误: {str(e)})")
        return {"success": True, "generated": len(results), "skipped": len(skipped), "skipped_names": skipped}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_submit_images_for_review(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.api.generation.assets import collect_submit_image_ids
        from app.services import ProjectService
        from app.services.ai.adapters.byteseed import is_asset_unsupported_model

        project = ProjectService.get_project(project_id) or {}
        video_config = (project.get("ai_config") or {}).get("video", {})
        video_model = (video_config.get("model") or "").strip()
        asset_review_required = not is_asset_unsupported_model(video_model)
        if not asset_review_required:
            return {
                "success": True,
                "asset_review_required": False,
                "video_model": video_model,
                "image_ids": [],
                "count": 0,
                "skipped": True,
                "notice": "当前视频模型不使用 asset:// 素材，已跳过提交审核流程。",
            }

        episode_id = parameters.get("episode_id")
        image_ids = parameters.get("image_ids")
        if not image_ids:
            image_ids = collect_submit_image_ids(project_id, episode_id)
        if not image_ids:
            return {"success": False, "error": "没有找到可提交的图片，请先为资产生成图片"}
        # 只返回 image_ids，实际提交由前端完成（走和"一键提交审核"完全相同的路径）
        return {"success": True, "asset_review_required": True, "video_model": video_model, "image_ids": image_ids, "count": len(image_ids)}
    except Exception as e:
        return {"success": False, "error": str(e)}
