"""查询工具执行逻辑"""
import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional
from app.services import AssetService, ImageService, ProjectService, get_ai_service
from app.models.project import normalize_global_style_config
from .helpers import check_asset_exists, KEY_ALIASES


def _extract_json_object(raw: str) -> Optional[Dict]:
    text = str(raw or "").strip()
    if not text:
        return None
    code_block_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if code_block_match:
        text = code_block_match.group(1).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


async def _build_script_analysis_with_llm(project_id: str, episode_id: str, script: str) -> Dict:
    project = ProjectService.get_project(project_id)
    if not project:
        return {"success": False, "error": "项目不存在"}

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    from app.services.global_prompt_service import get_prompt_content
    estimate_template = get_prompt_content("storyboard_plan_estimate", ai_config)
    if not estimate_template:
        return {"success": False, "error": "缺少提示词模板: storyboard_plan_estimate"}

    prompt = estimate_template.replace("{script}", (script or ""))

    try:
        result = await llm.chat([{"role": "user", "content": prompt}])
        content = result.get("content", "")
        parsed = _extract_json_object(content)
        if not parsed:
            return {"success": False, "error": "分镜规划解析失败：LLM未返回有效JSON"}

        dialogue_chars_total = int(parsed.get("dialogue_chars_total") or 0)
        estimated_storyboard_count = int(parsed.get("estimated_storyboard_count") or 0)
        suggested_dialogue_chars_per_storyboard = int(parsed.get("suggested_dialogue_chars_per_storyboard") or 0)

        if dialogue_chars_total <= 0 or estimated_storyboard_count <= 0 or suggested_dialogue_chars_per_storyboard <= 0:
            return {"success": False, "error": "分镜规划解析失败：关键字段必须大于0"}

        basis = parsed.get("estimation_basis") if isinstance(parsed.get("estimation_basis"), dict) else {}
        scenes = parsed.get("scenes") if isinstance(parsed.get("scenes"), list) else []
        normalized_scenes = []
        for item in scenes:
            if isinstance(item, dict):
                label = str(item.get("label") or "").strip()
                if label:
                    normalized_scenes.append({"label": label})
        has_scene_structure = bool(parsed.get("has_scene_structure")) or bool(normalized_scenes)
        scene_count = int(parsed.get("scene_count") or len(normalized_scenes) or 0)
        script_analysis = {
            "dialogue_chars_total": dialogue_chars_total,
            "estimated_storyboard_count": estimated_storyboard_count,
            "suggested_dialogue_chars_per_storyboard": suggested_dialogue_chars_per_storyboard,
            "has_scene_structure": has_scene_structure,
            "scene_count": scene_count,
            "scenes": normalized_scenes,
            "estimation_basis": {
                "has_explicit_storyboard_count": bool(basis.get("has_explicit_storyboard_count")),
                "explicit_storyboard_count": basis.get("explicit_storyboard_count"),
                "has_explicit_duration_seconds": bool(basis.get("has_explicit_duration_seconds")),
                "explicit_duration_seconds": basis.get("explicit_duration_seconds"),
                "rule_used": str(basis.get("rule_used") or "llm_estimate"),
                "default_seconds_per_storyboard": 15,
            },
        }

        plan_id = str(uuid.uuid4())
        plan_record = {
            "asset_id": plan_id,
            "episode_id": episode_id,
            "script_analysis": script_analysis,
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
        }
        AssetService.save_asset(project_id, "storyboard_plan", plan_record)

        return {"success": True, "plan_id": plan_id, "script_analysis": script_analysis}
    except Exception as e:
        return {"success": False, "error": f"分镜规划失败: {str(e)}"}
    finally:
        try:
            await llm.close()
        except Exception:
            pass


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
                    entry["voice_enabled"] = asset.get("voice_enabled", True)
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
                    entry["voice_enabled"] = a.get("voice_enabled", True)
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
        episode = AssetService.load_asset(project_id, "episode", episode_id)
        if not episode:
            return {"success": False, "error": "剧集不存在"}
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
                }
                if asset_type == "character":
                    item["voice_enabled"] = a.get("voice_enabled", True)
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
            "existing_storyboard_count": storyboard_count,
            "notice": f"⚠️ 已有资产见 existing_assets，已存在的直接用 asset_id，禁止重复创建。本集已有 {storyboard_count} 个分镜{'，自动生成本集时应跳过创建分镜步骤，继续后续的生图/审核/视频流程' if storyboard_count > 0 else '，需要创建分镜'}。"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_estimate_storyboard_plan(project_id: str, parameters: Dict, ai_config: Optional[Dict] = None) -> Dict:
    episode_id = parameters.get("episode_id")
    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        return {"success": False, "error": "剧集不存在"}

    script = str(episode.get("script") or "").strip()
    if not script:
        return {"success": False, "error": "剧本为空，无法进行分镜规划估算"}

    return await _build_script_analysis_with_llm(project_id, episode_id, script)
