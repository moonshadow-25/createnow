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
from .models import VideoPromptRequest, VideoReversePromptRequest, VideoGenerateRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/video-prompt")
async def generate_video_prompt(project_id: str, request: VideoPromptRequest):
    """生成视频提示词"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 获取项目的自定义提示词模板
    custom_templates = ai_config.get("prompt_templates", {})
    custom_template = custom_templates.get("video_prompt_template")

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
            custom_template=custom_template
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

    # 获取项目的自定义提示词模板
    custom_templates = ai_config.get("prompt_templates", {})
    custom_template = custom_templates.get("video_reverse_prompt_template")

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

    # 使用 image_ids（已由 validator 自动转换）
    image_ids = request.image_ids
    if not image_ids:
        raise HTTPException(status_code=400, detail="No images provided")

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

        for image_id in image_ids:
            image = ImageService.get_image(project_id, image_id)
            if not image:
                raise HTTPException(status_code=404, detail=f"Image {image_id} not found")

            image_url = None

            # 优先使用本地文件（转base64）
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

            # 根据配置决定是否压缩图片到1080p（默认不压缩）
            scale_to_1080p = ai_config.get("video", {}).get("scale_to_1080p", False)
            if scale_to_1080p:
                logger.info(f"[视频生成] 1080p缩放已启用，开始压缩图片")
                image_url = video_service.scale_image_to_1080p(image_url)
            else:
                logger.info(f"[视频生成] 1080p缩放已禁用，使用原始图片")

            image_urls.append(image_url)

        # 读取传输格式配置（默认使用multipart/form-data）
        use_multipart = ai_config.get("video", {}).get("use_multipart", True)
        logger.info(f"[视频生成] 传输格式: {'multipart/form-data' if use_multipart else 'JSON'}")
        logger.info(f"[视频生成] 图片数量: {len(image_urls)} ({'首尾帧模式' if len(image_urls) == 2 else '单图模式'})")

        # 调用视频生成服务
        if len(image_urls) == 1:
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
