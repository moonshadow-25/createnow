"""
Generation API - 视频生成相关端点
"""

import logging
import asyncio
import uuid
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Body

from app.services import get_ai_service, PromptService, ImageService
from app.core.config import settings
from .models import VideoPromptRequest, VideoReversePromptRequest, VideoGenerateRequest, MultiSceneVideoPromptRequest
from .template_helpers import get_active_template

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/video-prompt")
async def generate_video_prompt(project_id: str, request: VideoPromptRequest):
    """生成视频提示词"""
    from app.services import ProjectService
    from .style_presets import get_video_style_suffix

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 使用辅助函数获取当前激活的视频模板
    custom_template = get_active_template(ai_config, "video")

    # 读取全局风格配置
    global_style_config = ai_config.get("global_style_config", {})
    language = global_style_config.get("prompt_language", "zh")

    # 获取视频风格后缀
    video_style = global_style_config.get("video_style", {})
    style_suffix = ""
    if video_style.get("enabled", True):
        preset_id = video_style.get("preset_id", "none")
        if preset_id == "custom":
            style_suffix = video_style.get("custom_suffix", "")
        elif preset_id != "none":
            style_suffix = get_video_style_suffix(preset_id, language)

    # 记录请求日志
    request_log = {
        "description": request.description[:500] + "..." if len(request.description) > 500 else request.description,
        "dialogue": request.dialogue,
        "action": request.action,
        "shot_type": request.shot_type,
        "camera_angle": request.camera_angle,
        "characters": request.characters,
        "scene": request.scene,
        "props": request.props,
        "duration": request.duration,
    }

    # 构建 assets_desc（供模板中 {assets_desc} 使用）
    from app.services import AssetService
    assets_lines = []
    img_idx = 1
    for cid in request.characters:
        char = AssetService.load_asset(project_id, "character", cid)
        if char:
            assets_lines.append(f"图{img_idx}（角色）：{char.get('name', '')} - {char.get('description', '')}")
            img_idx += 1
    if request.scene:
        scene_asset = AssetService.load_asset(project_id, "scene", request.scene)
        if scene_asset:
            assets_lines.append(f"图{img_idx}（场景）：{scene_asset.get('name', '')} - {scene_asset.get('description', '')}")
            img_idx += 1
    for pid in request.props:
        prop = AssetService.load_asset(project_id, "prop", pid)
        if prop:
            assets_lines.append(f"图{img_idx}（道具）：{prop.get('name', '')} - {prop.get('description', '')}")
            img_idx += 1
    assets_desc = "\n".join(assets_lines) if assets_lines else "（无参考资产）"

    try:
        result = await PromptService.generate_video_prompt(
            llm,
            description=request.description,
            dialogue=request.dialogue,
            action=request.action,
            shot_type=request.shot_type,
            camera_angle=request.camera_angle,
            characters=request.characters,
            scene=request.scene,
            props=request.props,
            duration=request.duration,
            custom_template=custom_template,
            language=language,
            style_suffix=style_suffix,
            assets_desc=assets_desc
        )
        await llm.close()
        return {"prompt": result}

    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video-reverse-prompt")
async def generate_video_reverse_prompt(project_id: str, request: VideoReversePromptRequest):
    """反推视频提示词（使用VLM分析图片）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 检查VLM配置，如果没有则回退到LLM
    vlm_config = ai_config.get("vlm", {})
    if vlm_config.get("api_url") and vlm_config.get("api_key"):
        vlm = get_ai_service(ai_config, "vlm", project_id)
    else:
        # 回退到LLM配置
        vlm = get_ai_service(ai_config, "llm", project_id)
        logger.warning(f"[反推提示词] VLM未配置，回退使用LLM")

    # 使用辅助函数获取当前激活的视频反推模板
    custom_template = get_active_template(ai_config, "video_reverse")

    try:
        result = await PromptService.generate_video_reverse_prompt(
            vlm,
            image_base64=request.image_base64,
            description=request.description,
            dialogue=request.dialogue,
            action=request.action,
            shot_type=request.shot_type,
            camera_angle=request.camera_angle,
            characters=request.characters,
            scene=request.scene,
            props=request.props,
            duration=request.duration,
            custom_template=custom_template
        )
        await vlm.close()
        return {"prompt": result}

    except Exception as e:
        await vlm.close()
        logger.error(f"[反推提示词] 生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video")
async def generate_video(project_id: str, request: VideoGenerateRequest):
    """生成视频（支持单图和首尾帧模式）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_service = get_ai_service(ai_config, "video", project_id)

    # 多模态路径（video_urls / audio_urls）：不需要 image_ids
    has_multimodal = bool(request.video_urls or request.audio_urls)

    # 使用 image_ids（已由 validator 自动转换）
    image_ids = list(request.image_ids) if request.image_ids else []
    if not image_ids and not has_multimodal:
        raise HTTPException(status_code=400, detail="No images provided")

    multimodal_reference = ai_config.get("video", {}).get("multimodal_reference", False)

    # 记录请求日志
    request_log = {
        "storyboard_id": request.storyboard_id,
        "episode_id": request.episode_id,
        "image_ids": image_ids,
        "prompt": request.prompt[:500] + "..." if len(request.prompt) > 500 else request.prompt,
        "duration": request.duration,
        "resolution": request.resolution,
    }

    try:
        # 处理所有图片，转换为URL或base64
        image_urls = []

        for image_id in (image_ids or []):
            image = ImageService.get_image(project_id, image_id)
            if not image:
                raise HTTPException(status_code=404, detail=f"Image {image_id} not found")

            image_url = None

            # 优先使用 Volcengine Asset ID（asset:// URI）
            if image.get("volcengine_asset_id") and image.get("volcengine_asset_status") == "Active":
                image_url = f"asset://{image['volcengine_asset_id']}"
                logger.info(f"[视频生成] 使用 Volcengine Asset URI: {image_url}")

            # 其次使用本地文件（转base64）
            if not image_url:
                local_path = image.get("local_path")
                if local_path:
                    local_file_path = settings.PROJECTS_DIR / project_id / "images" / "files" / local_path

                    if local_file_path.exists():
                        try:
                            from app.services.image_download_service import ImageDownloadService
                            image_url = ImageDownloadService.image_to_base64_url(local_file_path)
                            logger.info(f"[视频生成] 使用本地图片 (base64): {local_path}")
                        except Exception as e:
                            logger.warning(f"[视频生成] 读取本地图片失败 {local_path}: {e}，尝试使用URL")

            # 降级到外部URL
            if not image_url:
                image_path = image.get("image_path")
                if image_path and image_path.startswith(("http://", "https://")):
                    image_url = image_path
                    logger.info(f"[视频生成] 使用外部URL: {image_path[:100]}")

            if not image_url:
                raise HTTPException(
                    status_code=404,
                    detail=f"Image {image_id}: 本地文件不存在且无有效URL"
                )

            # 根据配置决定是否压缩图片到1080p（asset:// URI 跳过缩放）
            scale_to_1080p = ai_config.get("video", {}).get("scale_to_1080p", False)
            if scale_to_1080p and not image_url.startswith("asset://"):
                logger.info(f"[视频生成] 1080p缩放已启用，开始压缩图片")
                image_url = video_service.scale_image_to_1080p(image_url)
            else:
                logger.info(f"[视频生成] 1080p缩放已禁用，使用原始图片")

            image_urls.append(image_url)

        # 读取传输格式配置（默认使用multipart/form-data）
        use_multipart = ai_config.get("video", {}).get("use_multipart", True)
        logger.info(f"[视频生成] 传输格式: {'multipart/form-data' if use_multipart else 'JSON'}")

        # 调用视频生成服务
        if has_multimodal or (multimodal_reference and len(image_urls) > 1):
            # 多模态路径（Seedance 2.0 / 全能参考）
            logger.info(f"[视频生成] 多模态模式: images={len(image_urls)}, videos={len(request.video_urls or [])}, audios={len(request.audio_urls or [])}")
            result = await video_service.generate_multimodal(
                prompt=request.prompt,
                image_urls=image_urls if image_urls else None,
                video_urls=request.video_urls,
                audio_urls=request.audio_urls,
                duration=request.duration,
                resolution=request.resolution,
                ratio=request.ratio,
                use_web_search=request.use_web_search,
            )
        elif len(image_urls) == 1:
            # 单图模式
            result = await video_service.generate(
                image_url=image_urls[0],
                prompt=request.prompt,
                duration=request.duration,
                resolution=request.resolution,
                use_multipart=use_multipart
            )
        else:
            # 多图模式（首尾帧）
            result = await video_service.generate_multi_image(
                image_urls=image_urls,
                prompt=request.prompt,
                duration=request.duration,
                resolution=request.resolution,
                use_multipart=use_multipart
            )

        await video_service.close()

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        # 创建视频记录（状态为 pending，等待轮询更新）
        video_id = str(uuid.uuid4())
        record = {
            "video_id": video_id,
            "storyboard_id": request.storyboard_id,
            "episode_id": request.episode_id,
            "prompt": request.prompt,
            "video_path": None,  # 尚未生成完成
            "duration": request.duration,
            "resolution": request.resolution,
            "model": ai_config.get("video", {}).get("model", "sora"),
            "created_at": datetime.now().isoformat(),
            "task_id": result.get("task_id", ""),
            "status": "pending",  # 等待轮询
            "poll_count": 0,
            "last_poll_time": None,
            "last_poll_response": None,
        }

        # 保存视频记录到文件
        videos_dir = settings.PROJECTS_DIR / project_id / "videos"
        videos_dir.mkdir(exist_ok=True)
        video_file = videos_dir / f"{video_id}.json"
        with open(video_file, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        return record

    except HTTPException:
        raise
    except Exception as e:
        await video_service.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/videos")
async def list_videos(project_id: str, episode_id: str = None):
    """列出项目的所有视频记录"""
    videos_dir = settings.PROJECTS_DIR / project_id / "videos"
    if not videos_dir.exists():
        return []

    videos = []
    for video_file in videos_dir.glob("*.json"):
        try:
            with open(video_file, "r", encoding="utf-8") as f:
                video = json.load(f)
                # 如果指定了 episode_id，则过滤
                if episode_id and video.get("episode_id") != episode_id:
                    continue
                videos.append(video)
        except Exception as e:
            logger.error(f"Error reading video file {video_file}: {e}")

    # 按创建时间倒序排列
    videos.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return videos


@router.get("/videos/{video_id}")
async def get_video(project_id: str, video_id: str):
    """获取单个视频记录"""
    video_file = settings.PROJECTS_DIR / project_id / "videos" / f"{video_id}.json"
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(video_file, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("/videos/{video_id}/poll")
async def poll_video_status(project_id: str, video_id: str):
    """轮询视频生成状态，更新视频记录"""
    from app.services import ProjectService

    # 获取视频记录
    video_file = settings.PROJECTS_DIR / project_id / "videos" / f"{video_id}.json"
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(video_file, "r", encoding="utf-8") as f:
        video_record = json.load(f)

    # 如果已经完成或失败，直接返回
    if video_record.get("status") in ("completed", "failed"):
        return video_record

    task_id = video_record.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="No task_id found for this video")

    # 获取项目配置
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_service = get_ai_service(ai_config, "video", project_id)

    try:
        # 调用轮询接口
        poll_result = await video_service.poll_video_task(task_id)
        await video_service.close()

        # 更新视频记录
        video_record["poll_count"] = video_record.get("poll_count", 0) + 1
        video_record["last_poll_time"] = datetime.now().isoformat()
        video_record["last_poll_response"] = poll_result.get("raw_poll_response")

        if poll_result.get("status") == "completed":
            video_record["status"] = "completed"
            video_record["video_path"] = poll_result.get("video_url")
            video_record["enhanced_prompt"] = poll_result.get("enhanced_prompt", "")

            # 【自动下载】视频生成完成后自动下载到本地
            from app.services.video_download_service import VideoDownloadService
            video_url = poll_result.get("video_url")
            if video_url and video_url.startswith(("http://", "https://")):
                try:
                    # 异步下载，不阻塞轮询响应
                    asyncio.create_task(
                        VideoDownloadService.download_and_save_video(
                            project_id=project_id,
                            video_id=video_id,
                            url=video_url
                        )
                    )
                except Exception as e:
                    logger.warning(f"启动视频自动下载失败 (video_id: {video_id}): {e}")
        elif poll_result.get("status") == "failed":
            video_record["status"] = "failed"
            video_record["error"] = poll_result.get("error")
        else:
            # 仍在 pending
            video_record["status"] = poll_result.get("status", "pending")

        # 保存更新后的记录
        with open(video_file, "w", encoding="utf-8") as f:
            json.dump(video_record, f, ensure_ascii=False, indent=2)

        return video_record

    except Exception as e:
        await video_service.close()
        logger.error(f"Error polling video {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/videos/{video_id}/set-primary")
async def set_primary_video(project_id: str, video_id: str, storyboard_id: str = Body(..., embed=True)):
    """设置主视频"""
    videos_dir = settings.PROJECTS_DIR / project_id / "videos"
    if not videos_dir.exists():
        raise HTTPException(status_code=404, detail="No videos found")

    # 获取目标视频
    target_video_file = videos_dir / f"{video_id}.json"
    if not target_video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(target_video_file, "r", encoding="utf-8") as f:
        target_video = json.load(f)

    # 验证分镜ID匹配
    if target_video.get("storyboard_id") != storyboard_id:
        raise HTTPException(status_code=400, detail="Video does not belong to this storyboard")

    # 取消该分镜的其他视频的主视频状态
    for video_file in videos_dir.glob("*.json"):
        try:
            with open(video_file, "r", encoding="utf-8") as f:
                video = json.load(f)

            if video.get("storyboard_id") == storyboard_id and video.get("is_primary"):
                video["is_primary"] = False
                with open(video_file, "w", encoding="utf-8") as f:
                    json.dump(video, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error updating video file {video_file}: {e}")

    # 设置目标视频为主视频
    target_video["is_primary"] = True
    with open(target_video_file, "w", encoding="utf-8") as f:
        json.dump(target_video, f, ensure_ascii=False, indent=2)

    return {"success": True, "video": target_video}


@router.post("/multi-scene-video-prompt")
async def generate_multi_scene_video_prompt(
    project_id: str,
    request: MultiSceneVideoPromptRequest
):
    """生成多分镜融合视频提示词（使用LLM）"""
    from app.services import ProjectService, AssetService

    try:
        logger.info(f"Received multi-scene video prompt request for project {project_id}")
        logger.info(f"Request data: {request}")
        logger.info(f"Storyboard IDs: {request.storyboard_ids}")
    except Exception as e:
        logger.error(f"Error logging request: {e}")

    # 1. 获取项目
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 2. 获取所有分镜
    storyboards = []
    for sb_id in request.storyboard_ids:
        sb = AssetService.load_asset(project_id, "storyboard", sb_id)
        if sb:
            storyboards.append(sb)

    if not storyboards:
        raise HTTPException(status_code=404, detail="No storyboards found")

    # 按sequence排序
    storyboards.sort(key=lambda x: x.get("sequence", 0))

    # 3. 获取剧集剧本（假设所有分镜属于同一剧集）
    episode_id = storyboards[0].get("episode_id")
    if not episode_id:
        raise HTTPException(status_code=400, detail="Storyboards must belong to an episode")

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")

    script_content = episode.get("script", "")

    # 4. 收集所有涉及的资产（去重）
    character_ids = set()
    scene_ids = set()
    prop_ids = set()

    for sb in storyboards:
        if sb.get("character_ids"):
            character_ids.update(sb["character_ids"])
        if sb.get("scene_ids"):
            scene_ids.update(sb["scene_ids"])
        elif sb.get("scene_id"):
            scene_ids.add(sb["scene_id"])
        if sb.get("prop_ids"):
            prop_ids.update(sb["prop_ids"])

    # 5. 获取资产详细信息
    characters_info = []
    for char_id in character_ids:
        char = AssetService.load_asset(project_id, "character", char_id)
        if char:
            info = char.get("description", "")
            if char.get("age"):
                info += f"，{char['age']}岁"
            if char.get("gender"):
                info += f"，{char['gender']}"
            characters_info.append(info)

    scenes_info = []
    for scene_id in scene_ids:
        scene = AssetService.load_asset(project_id, "scene", scene_id)
        if scene:
            scenes_info.append(scene.get("description", ""))

    props_info = []
    for prop_id in prop_ids:
        prop = AssetService.load_asset(project_id, "prop", prop_id)
        if prop:
            props_info.append(prop.get("description", ""))

    # 6. 构建分镜信息
    storyboards_info = []
    total_duration = 0
    for i, sb in enumerate(storyboards):
        duration = sb.get("duration", 3)
        total_duration += duration

        info = f"分镜{i+1}（时长{duration}秒）：\n"
        info += f"  描述：{sb.get('description', '')}\n"
        if sb.get("dialogue"):
            info += f"  对白：{sb['dialogue']}\n"
        if sb.get("shot_type"):
            info += f"  镜头类型：{sb['shot_type']}\n"
        if sb.get("camera_angle"):
            info += f"  镜头角度：{sb['camera_angle']}\n"
        if sb.get("action"):
            info += f"  动作：{sb['action']}\n"

        storyboards_info.append(info)

    # 7. 获取提示词模板
    ai_config = project.get("ai_config", {})
    template = get_active_template(ai_config, "multi_scene_video")

    if not template:
        raise HTTPException(status_code=500, detail="Multi-scene video prompt template not found")

    # 8. 填充模板
    prompt = template.format(
        script_content=script_content,
        storyboards_info="\n".join(storyboards_info),
        characters_info="；".join(characters_info) if characters_info else "无",
        scenes_info="；".join(scenes_info) if scenes_info else "无",
        props_info="；".join(props_info) if props_info else "无"
    )

    # 9. 调用LLM生成
    llm = get_ai_service(ai_config, "llm", project_id)

    try:
        response = await llm.chat([
            {"role": "user", "content": prompt}
        ])

        generated_prompt = response.get("content", "")

        await llm.close()

        return {
            "prompt": generated_prompt,
            "total_duration": total_duration,
            "storyboard_count": len(storyboards)
        }
    except Exception as e:
        await llm.close()
        logger.error(f"Error generating multi-scene video prompt: {e}")
        raise HTTPException(status_code=500, detail=str(e))

