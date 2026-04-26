"""生成工具执行逻辑"""
from datetime import datetime
from typing import Dict, Optional, Tuple, List, Any
from app.services import AssetService
from app.models.project import normalize_global_style_config


def _parse_global_video_resolution(raw_resolution: str | None) -> Tuple[str, Optional[str]]:
    """兼容旧值与新值，返回 (resolution, ratio)。"""
    value = raw_resolution or "1280x720"

    if value == "21:9-720p":
        return "1280x720", "21:9"
    if value == "1280x720":
        return "1280x720", None
    if value == "720x1280":
        return "720x1280", None

    matched = value.split("-", 1)
    if len(matched) == 2:
        ratio, resolution = matched
        if ratio in {"16:9", "9:16", "21:9"} and resolution in {"480p", "720p", "1080p"}:
            return resolution, ratio

    if value in {"480p", "720p", "1080p"}:
        return value, None

    return value, None


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
        if char.get("voice_audio_id"):
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
            "message": "无资产需要校验",
        }

    strict_match = expected_compact == actual_compact
    return {
        "status": "ok" if strict_match else "mismatch",
        "expected": expected_lines,
        "actual": actual_lines,
        "message": "asset definitions 顺序已校验" if strict_match else "asset definitions 顺序不一致，请按 expected 顺序使用 @图N",
    }


async def handle_generate_asset_image(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    try:
        from app.api.generation.image import generate_image_core
        from app.api.generation.utils import check_project_budget
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
        saved = await generate_image_core(project_id=project_id, asset_id=asset_id, asset_type=asset_type, prompt=image_prompt, ai_config=ai_config)
        return {"success": True, "image_id": saved["image_id"], "asset_name": asset.get("name", asset_id)}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_generate_all_asset_images(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    try:
        from app.api.generation.image import generate_image_core
        from app.api.generation.utils import check_project_budget
        from app.services import ProjectService
        import asyncio
        asset_types = parameters.get("asset_types", ["character", "scene", "prop"])
        proj = ProjectService.get_project(project_id)
        check_project_budget(proj)

        tasks = []
        for atype in asset_types:
            for asset in (AssetService.list_assets(project_id, atype) or []):
                if asset.get("image_prompt"):
                    tasks.append((asset, atype))

        if not tasks:
            return {"success": True, "generated": 0, "skipped": 0, "details": [], "skipped_names": []}

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


async def handle_generate_storyboard_video_prompt_subagent(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    """独立子代：单独为某个分镜生成并保存 video_prompt，附带资产顺序拦截。"""
    return {
        "success": False,
        "error": "请使用 /generate/video-prompt-subagent 接口，该工具入口已保留但不在当前链路启用",
    }


async def handle_generate_storyboard_video(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.api.generation.video import generate_video
        from app.api.generation.models import VideoGenerateRequest
        from app.services import ProjectService
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
        proj = ProjectService.get_project(project_id)
        global_style_config = normalize_global_style_config(proj.get("ai_config", {}).get("global_style_config"))
        global_resolution, global_ratio = _parse_global_video_resolution(
            global_style_config.get("global_resolution", "1280x720")
        )
        resolution = storyboard.get("resolution") or global_resolution
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
        req = VideoGenerateRequest(storyboard_id=storyboard_id, episode_id=ep_id, image_ids=image_ids, prompt=video_prompt, duration=storyboard.get("duration", 6), resolution=resolution, ratio=global_ratio)
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
        from app.services import ProjectService
        episode_id = parameters.get("episode_id")
        storyboards = AssetService.list_assets(project_id, "storyboard") or []
        if episode_id:
            storyboards = [s for s in storyboards if s.get("episode_id") == episode_id]
        proj = ProjectService.get_project(project_id)
        global_style_config = normalize_global_style_config(proj.get("ai_config", {}).get("global_style_config"))
        global_resolution, global_ratio = _parse_global_video_resolution(
            global_style_config.get("global_resolution", "1280x720")
        )
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
                req = VideoGenerateRequest(storyboard_id=sid, episode_id=ep_id, image_ids=image_ids, prompt=video_prompt, duration=sb.get("duration", 6), resolution=sb.get("resolution") or global_resolution, ratio=global_ratio)
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
        episode_id = parameters.get("episode_id")
        image_ids = parameters.get("image_ids")
        if not image_ids:
            image_ids = collect_submit_image_ids(project_id, episode_id)
        if not image_ids:
            return {"success": False, "error": "没有找到可提交的图片，请先为资产生成图片"}
        # 只返回 image_ids，实际提交由前端完成（走和"一键提交审核"完全相同的路径）
        return {"success": True, "image_ids": image_ids, "count": len(image_ids)}
    except Exception as e:
        return {"success": False, "error": str(e)}
