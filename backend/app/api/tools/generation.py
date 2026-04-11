"""生成工具执行逻辑"""
from typing import Dict
from app.services import AssetService


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
        asset_types = parameters.get("asset_types", ["character", "scene", "prop"])
        proj = ProjectService.get_project(project_id)
        check_project_budget(proj)
        results, skipped = [], []
        for atype in asset_types:
            for asset in (AssetService.list_assets(project_id, atype) or []):
                aid = asset.get("asset_id")
                image_prompt = asset.get("image_prompt", "")
                if not image_prompt:
                    skipped.append(asset.get("name", aid))
                    continue
                try:
                    saved = await generate_image_core(project_id=project_id, asset_id=aid, asset_type=atype, prompt=image_prompt, ai_config=ai_config)
                    results.append({"name": asset.get("name", aid), "image_id": saved["image_id"]})
                except Exception as e:
                    skipped.append(f"{asset.get('name', aid)}(错误: {str(e)})")
        return {"success": True, "generated": len(results), "skipped": len(skipped), "details": results, "skipped_names": skipped}
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
        global_style_config = proj.get("ai_config", {}).get("global_style_config", {})
        global_resolution = global_style_config.get("global_resolution", "1280x720")
        global_ratio = None
        if global_resolution == "21:9-720p":
            global_resolution = "1280x720"
            global_ratio = "21:9"
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
        global_resolution = proj.get("ai_config", {}).get("global_style_config", {}).get("global_resolution", "1280x720")
        global_ratio = None
        if global_resolution == "21:9-720p":
            global_resolution = "1280x720"
            global_ratio = "21:9"
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
