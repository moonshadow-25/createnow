from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
import asyncio
from typing import List, Optional, Union
from pydantic import BaseModel
from datetime import datetime
import os
import time

from app.services import AssetService, PromptService, get_ai_service, VideoReverseService
from app.services.asset_service import ProjectService
from app.services.storyboard_asset_service import (
    extract_assets_from_storyboards,
    match_assets_to_storyboards,
)
from app.services.asset_service import ImageService
from app.services.video_service import VideoService
from app.models.project import Storyboard
from app.core.config import settings
from app.core.context import get_current_data_root
from app.models.project import normalize_global_style_config
from app.api.generation.template_helpers import get_active_template

router = APIRouter(prefix="/projects/{project_id}/storyboards", tags=["storyboards"])


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class StoryboardCreate(BaseModel):
    episode_id: str
    sequence: int
    description: str
    script_scene_label: Optional[str] = None
    character_ids: List[str] = []
    scene_id: str = None
    scene_ids: List[str] = []
    prop_ids: List[str] = []
    camera_angle: str = None
    shot_type: str = None
    dialogue: str = ""
    action: str = ""
    image_prompt: str = None
    video_prompt: Optional[Union[str, List[str]]] = None
    duration: Optional[int] = None
    resolution: Optional[str] = None


class StoryboardUpdate(BaseModel):
    description: Optional[str] = None
    script_scene_label: Optional[str] = None
    character_ids: Optional[List[str]] = None
    scene_id: Optional[str] = None
    scene_ids: Optional[List[str]] = None
    prop_ids: Optional[List[str]] = None
    camera_angle: Optional[str] = None
    shot_type: Optional[str] = None
    dialogue: Optional[str] = None
    action: Optional[str] = None
    image_prompt: Optional[str] = None
    video_prompt: Optional[Union[str, List[str]]] = None
    duration: Optional[int] = None
    resolution: Optional[str] = None


class StoryboardGenerateRequest(BaseModel):
    episode_id: str
    script: str


@router.post("", response_model=dict)
async def create_storyboard(project_id: str, storyboard: StoryboardCreate):
    """创建分镜"""
    data = storyboard.model_dump()
    result = AssetService.save_asset(project_id, "storyboard", data)
    return result


@router.get("/{storyboard_id}", response_model=dict)
async def get_storyboard(project_id: str, storyboard_id: str):
    """获取分镜详情"""
    result = AssetService.load_asset(project_id, "storyboard", storyboard_id)
    if not result:
        raise HTTPException(status_code=404, detail="Storyboard not found")
    return result


@router.put("/{storyboard_id}", response_model=dict)
async def update_storyboard(project_id: str, storyboard_id: str, storyboard: StoryboardUpdate):
    """更新分镜"""
    current = AssetService.load_asset(project_id, "storyboard", storyboard_id)
    if not current:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    # 部分更新：只更新提供的字段
    data = storyboard.model_dump(exclude_unset=True)

    # 更新提供的字段到现有数据
    for key, value in data.items():
        current[key] = value
    current["updated_at"] = datetime.now().isoformat()

    result = AssetService.save_asset(project_id, "storyboard", current)
    return result


@router.delete("/{storyboard_id}")
async def delete_storyboard(project_id: str, storyboard_id: str):
    """删除分镜并自动调整后续分镜序号"""
    # 1. 获取要删除的分镜信息
    storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
    if not storyboard:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    episode_id = storyboard.get("episode_id")
    deleted_sequence = storyboard.get("sequence", 0)

    # 2. 删除分镜
    success = AssetService.delete_asset(project_id, "storyboard", storyboard_id)
    if not success:
        raise HTTPException(status_code=404, detail="Failed to delete storyboard")

    # 3. 调整后续分镜序号 (sequence > deleted_sequence 的都减1)
    all_storyboards = AssetService.list_assets(project_id, "storyboard")
    for sb in all_storyboards:
        if sb.get("episode_id") == episode_id and sb.get("sequence", 0) > deleted_sequence:
            sb["sequence"] = sb["sequence"] - 1
            AssetService.save_asset(project_id, "storyboard", sb)

    return {"success": True}


@router.post("/generate")
async def generate_storyboards(project_id: str, request: StoryboardGenerateRequest):
    """AI生成分镜描述"""
    from app.services import ProjectService

    print(f"[DEBUG] generate_storyboards called - episode_id: {request.episode_id}")
    print(f"[DEBUG] Script length: {len(request.script)}")
    print(f"[DEBUG] Script preview: {request.script[:200]}...")

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 使用辅助函数获取当前激活的分镜生成模板
    custom_template = get_active_template(ai_config, "storyboard")

    try:
        # 1. 删除该剧集下的所有现有分镜
        all_storyboards = AssetService.list_assets(project_id, "storyboard")
        episode_storyboards = [
            sb for sb in all_storyboards if sb.get("episode_id") == request.episode_id
        ]
        deleted_count = 0
        for sb in episode_storyboards:
            if AssetService.delete_asset(project_id, "storyboard", sb["asset_id"]):
                deleted_count += 1
        print(f"[DEBUG] Deleted {deleted_count} existing storyboards for episode {request.episode_id}")

        # 2. 生成新分镜
        storyboards = await PromptService.generate_storyboard_descriptions(
            llm, request.script, custom_template
        )
        await llm.close()

        print(f"[DEBUG] Generated {len(storyboards)} storyboards")

        # 3. 保存所有新分镜
        results = []
        for sb_data in storyboards:
            sb_data["episode_id"] = request.episode_id
            # 如果模板生成的是九宫格分镜，标记 storyboard_mode
            if sb_data.get("shot_type") == "九宫格分镜":
                sb_data["storyboard_mode"] = "nine_grid"
            result = AssetService.save_asset(project_id, "storyboard", sb_data)
            results.append(result)

        print(f"[DEBUG] Saved {len(results)} storyboards")
        return {"storyboards": results}

    except Exception as e:
        await llm.close()
        print(f"[ERROR] generate_storyboards failed: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/episode/{episode_id}/video-reverse")
async def reverse_episode_video(
    project_id: str,
    episode_id: str,
    file: UploadFile = File(...),
    overwrite_script: bool = Form(True),
    overwrite_storyboards: bool = Form(True),
    extract_characters: bool = Form(True),
    match_assets: bool = Form(True),
    preprocess_fps: int = Form(1),
):
    """上传视频并反推该集剧本、分镜与剧情分析。"""
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    try:
        result = await VideoReverseService.reverse_episode_video(
            project_id=project_id,
            episode_id=episode_id,
            upload_file=file,
            ai_config=ai_config,
            overwrite_script=overwrite_script,
            overwrite_storyboards=overwrite_storyboards,
            extract_characters=extract_characters,
            match_assets=match_assets,
            preprocess_fps=preprocess_fps,
        )
        return {
            "success": True,
            **result,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"视频反推失败: {str(e)}")


@router.get("/episode/{episode_id}", response_model=List[dict])
async def list_episode_storyboards(project_id: str, episode_id: str):
    """列出剧集的所有分镜（包含主图URL）"""
    t0 = time.perf_counter()
    storyboards = await asyncio.to_thread(AssetService.list_assets, project_id, "storyboard")
    episode_storyboards = [sb for sb in storyboards if sb.get("episode_id") == episode_id]
    t1 = time.perf_counter()

    asset_ids = [sb["asset_id"] for sb in episode_storyboards]
    primary_images = await asyncio.to_thread(ImageService.get_primary_images_batch, project_id, asset_ids)
    t2 = time.perf_counter()

    # 批量查询主视频用于注入 primary_video_url（无论是否有主图）
    primary_videos = await asyncio.to_thread(VideoService.get_primary_videos_batch, project_id, asset_ids) if asset_ids else {}
    t3 = time.perf_counter()

    for sb in episode_storyboards:
        primary_image = primary_images.get(sb["asset_id"])
        if primary_image:
            if primary_image.get("local_path"):
                sb["primary_image_url"] = f"/api/projects/{project_id}/images/files/{primary_image['local_path']}"
            else:
                sb["primary_image_url"] = primary_image.get("image_path")
            # 注入主图 image_id（分镜 JSON 可能未存储），前端用于状态查找
            if not sb.get("image_id") and primary_image.get("image_id"):
                sb["image_id"] = primary_image["image_id"]
            # 注入主图审核状态，前端据此决定是否需要轮询
            sb["volcengine_asset_id"] = primary_image.get("volcengine_asset_id")
            sb["volcengine_asset_status"] = primary_image.get("volcengine_asset_status")
            # 确保 image_id 存在（分镜 JSON 可能未存储）
            if not sb.get("image_id") and primary_image.get("image_id"):
                sb["image_id"] = primary_image["image_id"]
        else:
            sb["primary_image_url"] = None
            sb["volcengine_asset_id"] = None
            sb["volcengine_asset_status"] = None

        # 注入主视频 URL 及缩略图 URL（前端用于无主图时渲染首帧预览）
        primary_video = primary_videos.get(sb["asset_id"])
        if primary_video:
            if primary_video.get("local_path"):
                sb["primary_video_url"] = f"/api/projects/{project_id}/videos/files/{primary_video['local_path']}"
                # 懒生成视频首帧缩略图
                video_file_path = os.path.join(
                    str(_get_projects_dir()), project_id, "videos", "files", primary_video["local_path"]
                )
                thumb_filename = os.path.splitext(primary_video["local_path"])[0] + "_thumb.jpg"
                thumb_path = os.path.join(str(_get_projects_dir()), project_id, "videos", "thumbnails", thumb_filename)
                if not os.path.exists(thumb_path):
                    VideoService.extract_first_frame(video_file_path, thumb_path)
                if os.path.exists(thumb_path):
                    sb["primary_video_thumbnail_url"] = f"/api/projects/{project_id}/videos/thumbnails/{thumb_filename}"
                else:
                    sb["primary_video_thumbnail_url"] = None
            elif primary_video.get("video_path"):
                sb["primary_video_url"] = primary_video["video_path"]
                sb["primary_video_thumbnail_url"] = None
            else:
                sb["primary_video_url"] = None
                sb["primary_video_thumbnail_url"] = None
        else:
            sb["primary_video_url"] = None
            sb["primary_video_thumbnail_url"] = None

    episode_storyboards.sort(key=lambda x: x.get("sequence", 0))

    print(
        f"[PERF] list_episode_storyboards | project={project_id[:8]} | "
        f"episode_storyboards={len(episode_storyboards)} | "
        f"step1_list_storyboards={1000*(t1-t0):.1f}ms | "
        f"step2_get_primary_images={1000*(t2-t1):.1f}ms | "
        f"step3_get_primary_videos={1000*(t3-t2):.1f}ms | "
        f"TOTAL={1000*(t3-t0):.1f}ms"
    )
    return episode_storyboards


class StoryboardReorderRequest(BaseModel):
    episode_id: str
    old_sequence: int
    new_sequence: int


class RenumberRequest(BaseModel):
    episode_id: str


@router.post("/renumber")
async def renumber_storyboards(project_id: str, request: RenumberRequest):
    """按现有顺序重新编号所有分镜，消除序号间隙"""
    storyboards = AssetService.list_assets(project_id, "storyboard")
    episode_storyboards = [
        sb for sb in storyboards if sb.get("episode_id") == request.episode_id
    ]

    # 按当前sequence排序
    episode_storyboards.sort(key=lambda x: x.get("sequence", 0))

    # 重新编号 (1, 2, 3, ...)
    updated_count = 0
    for i, sb in enumerate(episode_storyboards):
        new_sequence = i + 1
        if sb.get("sequence") != new_sequence:
            sb["sequence"] = new_sequence
            AssetService.save_asset(project_id, "storyboard", sb)
            updated_count += 1

    return {"success": True, "count": len(episode_storyboards), "updated": updated_count}


@router.post("/reorder")
async def reorder_storyboard(project_id: str, request: StoryboardReorderRequest):
    """重新排序分镜 - 将一个分镜从旧序号移到新序号"""
    storyboards = AssetService.list_assets(project_id, "storyboard")
    episode_storyboards = [
        sb for sb in storyboards if sb.get("episode_id") == request.episode_id
    ]
    episode_storyboards.sort(key=lambda x: x.get("sequence", 0))

    # 找到要移动的分镜
    target_sb = None
    for sb in episode_storyboards:
        if sb.get("sequence") == request.old_sequence:
            target_sb = sb
            break

    if not target_sb:
        raise HTTPException(status_code=404, detail=f"未找到第{request.old_sequence}镜")

    # 更新目标分镜的序号
    target_sb["sequence"] = request.new_sequence
    AssetService.save_asset(project_id, "storyboard", target_sb)

    # 调整其他分镜的序号
    for sb in episode_storyboards:
        if sb["asset_id"] == target_sb["asset_id"]:
            continue
        curr_seq = sb.get("sequence", 0)
        if request.old_sequence < request.new_sequence:
            # 向后移动：中间的分镜序号减1
            if request.old_sequence < curr_seq <= request.new_sequence:
                sb["sequence"] = curr_seq - 1
                AssetService.save_asset(project_id, "storyboard", sb)
        else:
            # 向前移动：中间的分镜序号加1
            if request.new_sequence <= curr_seq < request.old_sequence:
                sb["sequence"] = curr_seq + 1
                AssetService.save_asset(project_id, "storyboard", sb)

    return {"success": True, "message": f"已将第{request.old_sequence}镜移动到第{request.new_sequence}镜"}


@router.get("/{storyboard_id}/video-thumbnail")
async def get_video_thumbnail(project_id: str, storyboard_id: str):
    """
    返回分镜主视频的第一帧缩略图（JPEG）。

    首次请求时用 FFmpeg 提取并缓存到 videos/thumbnails/{video_id}.jpg，
    后续直接返回缓存文件。
    """
    primary_video = VideoService.get_primary_video(project_id, storyboard_id)
    if not primary_video or not primary_video.get("local_path"):
        raise HTTPException(status_code=404, detail="No completed video for this storyboard")

    video_id = primary_video["video_id"]

    thumbnail_path = os.path.join(
        str(projects_dir), project_id, "videos", "thumbnails", f"{video_id}.jpg"
    )

    if not os.path.exists(thumbnail_path):
        video_path = os.path.join(
            str(projects_dir), project_id, "videos", "files", primary_video["local_path"]
        )
        success = VideoService.extract_first_frame(video_path, thumbnail_path)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to extract video thumbnail")

    return FileResponse(thumbnail_path, media_type="image/jpeg")


@router.post("/{storyboard_id}/create-end-frame")
async def create_end_frame(project_id: str, storyboard_id: str):
    """
    创建尾帧分镜

    从源分镜的主视频提取最后一帧，创建新分镜
    """
    try:
        # 1. 检查 FFmpeg
        if not VideoService.check_ffmpeg_installed():
            raise HTTPException(
                status_code=500,
                detail="FFmpeg is not installed on the server. Please contact administrator."
            )

        # 2. 加载源分镜
        source_storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not source_storyboard:
            raise HTTPException(status_code=404, detail="Source storyboard not found")

        # 3. 获取主视频
        primary_video = VideoService.get_primary_video(project_id, storyboard_id)
        if not primary_video:
            raise HTTPException(
                status_code=400,
                detail="No completed video found for this storyboard"
            )

        # 4. 构建视频路径
        # 视频文件在 videos/files/ 子目录下
        video_filename = primary_video["local_path"]
        video_path = os.path.join(
            str(_get_projects_dir()),
            project_id,
            "videos",
            "files",  # 视频文件在 files 子目录下
            video_filename
        )

        if not os.path.exists(video_path):
            raise HTTPException(
                status_code=404,
                detail=f"Video file not found: {video_filename}"
            )

        # 5. 提取最后一帧
        try:
            last_frame_path = VideoService.extract_last_frame(video_path, project_id)
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))

        # 6. 创建新分镜（复制源分镜属性）
        new_storyboard_data = {
            "episode_id": source_storyboard["episode_id"],
            "sequence": source_storyboard["sequence"] + 1,  # 插入到源分镜后面
            "description": source_storyboard["description"],
            "dialogue": source_storyboard.get("dialogue", ""),
            "action": source_storyboard.get("action", ""),
            "shot_type": source_storyboard.get("shot_type"),
            "camera_angle": source_storyboard.get("camera_angle"),
            "character_ids": source_storyboard.get("character_ids", []),
            "scene_id": source_storyboard.get("scene_id"),
            "prop_ids": source_storyboard.get("prop_ids", []),
            "created_at": datetime.now().isoformat(),
        }

        new_storyboard = AssetService.save_asset(project_id, "storyboard", new_storyboard_data)

        # 7. 为提取的帧创建图片记录
        image_record = ImageService.create_image_from_file(
            project_id=project_id,
            asset_id=new_storyboard["asset_id"],
            asset_type="storyboard",
            local_file_path=last_frame_path,
            prompt=f"Last frame from storyboard {source_storyboard.get('name', storyboard_id)}",
            is_primary=True
        )

        # 8. 更新新分镜的 image_id
        new_storyboard["image_id"] = image_record["image_id"]
        AssetService.save_asset(project_id, "storyboard", new_storyboard)

        # 9. 重新编号后续分镜
        all_storyboards = AssetService.list_assets(project_id, "storyboard")
        episode_storyboards = [
            s for s in all_storyboards
            if s.get("episode_id") == source_storyboard["episode_id"]
        ]
        episode_storyboards.sort(key=lambda x: x.get("sequence", 0))

        for idx, sb in enumerate(episode_storyboards, start=1):
            if sb["sequence"] != idx:
                sb["sequence"] = idx
                AssetService.save_asset(project_id, "storyboard", sb)

        return {
            "storyboard": new_storyboard,
            "image": image_record
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error creating end frame: {str(e)}"
        )


@router.post("/{storyboard_id}/insert-transition-frame")
async def insert_transition_frame(project_id: str, storyboard_id: str):
    """
    插入衔接帧

    从上一个分镜的主视频提取最后一帧，保存为当前分镜的非主图引用素材。
    不新建分镜，不占用当前分镜主图。
    """
    try:
        if not VideoService.check_ffmpeg_installed():
            raise HTTPException(
                status_code=500,
                detail="FFmpeg is not installed on the server. Please contact administrator."
            )

        current_storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not current_storyboard:
            raise HTTPException(status_code=404, detail="Storyboard not found")

        episode_id = current_storyboard.get("episode_id")
        sequence = int(current_storyboard.get("sequence") or 0)
        if not episode_id or sequence <= 1:
            raise HTTPException(status_code=400, detail="No previous storyboard available")

        all_storyboards = AssetService.list_assets(project_id, "storyboard")
        previous_storyboard = next(
            (
                sb for sb in all_storyboards
                if sb.get("episode_id") == episode_id and int(sb.get("sequence") or 0) == sequence - 1
            ),
            None,
        )
        if not previous_storyboard:
            raise HTTPException(status_code=400, detail="Previous storyboard not found")

        previous_storyboard_id = previous_storyboard["asset_id"]
        primary_video = VideoService.get_primary_video(project_id, previous_storyboard_id)
        if not primary_video:
            raise HTTPException(status_code=400, detail="Previous storyboard has no completed primary video")

        video_filename = primary_video.get("local_path")
        if not video_filename:
            raise HTTPException(status_code=400, detail="Previous storyboard primary video local path is missing")

        video_path = os.path.join(
            str(_get_projects_dir()),
            project_id,
            "videos",
            "files",
            video_filename,
        )
        if not os.path.exists(video_path):
            raise HTTPException(status_code=404, detail=f"Video file not found: {video_filename}")

        try:
            last_frame_path = VideoService.extract_last_frame(
                video_path,
                project_id,
                output_subdir="transition_frames",
            )
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))

        image_record = ImageService.create_image_from_file(
            project_id=project_id,
            asset_id=current_storyboard["asset_id"],
            asset_type="storyboard",
            local_file_path=last_frame_path,
            prompt=f"Transition end frame from storyboard {previous_storyboard_id}",
            is_primary=False,
        )

        now = datetime.now().isoformat()
        current_storyboard["transition_frame_image_id"] = image_record["image_id"]
        current_storyboard["transition_frame_source_storyboard_id"] = previous_storyboard_id
        current_storyboard["transition_frame_source_video_id"] = primary_video.get("video_id")
        current_storyboard["transition_frame_updated_at"] = now
        current_storyboard["updated_at"] = now
        saved_storyboard = AssetService.save_asset(project_id, "storyboard", current_storyboard)

        return {
            "success": True,
            "storyboard_id": storyboard_id,
            "previous_storyboard_id": previous_storyboard_id,
            "source_video_id": primary_video.get("video_id"),
            "transition_image": {
                "image_id": image_record.get("image_id"),
                "local_path": image_record.get("local_path"),
                "volcengine_asset_id": image_record.get("volcengine_asset_id"),
                "volcengine_asset_status": image_record.get("volcengine_asset_status"),
                "is_primary": image_record.get("is_primary", False),
            },
            "storyboard_transition_ref": {
                "transition_frame_image_id": saved_storyboard.get("transition_frame_image_id"),
                "transition_frame_source_storyboard_id": saved_storyboard.get("transition_frame_source_storyboard_id"),
                "transition_frame_source_video_id": saved_storyboard.get("transition_frame_source_video_id"),
                "transition_frame_updated_at": saved_storyboard.get("transition_frame_updated_at"),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error inserting transition frame: {str(e)}")


@router.post("/{storyboard_id}/auto-match-assets")
async def auto_match_assets(project_id: str, storyboard_id: str):
    """
    自动匹配分镜资产

    根据分镜描述、剧集剧本和资产库，使用AI智能匹配适合的资产
    匹配规则：场景最多1个，角色+道具总共不超过3个，总计不超过4个资产
    """
    from app.services import ProjectService

    try:
        # 1. 加载分镜
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            raise HTTPException(status_code=404, detail="Storyboard not found")

        # 2. 获取项目信息和AI配置
        project = ProjectService.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        ai_config = project.get("ai_config", {})
        llm = get_ai_service(ai_config, "llm", project_id)

        # 3. 获取所有资产
        characters = AssetService.list_assets(project_id, "character")
        scenes = AssetService.list_assets(project_id, "scene")
        props = AssetService.list_assets(project_id, "prop")

        # 4. 获取剧集剧本（如果有episode_id）
        episode_script = ""
        episode_id = storyboard.get("episode_id")
        if episode_id:
            try:
                episode = AssetService.load_asset(project_id, "episode", episode_id)
                if episode:
                    episode_script = episode.get("script", "")
            except:
                pass  # 如果获取剧集失败，继续执行

        # 5. 调用AI匹配资产
        matched_assets = await PromptService.auto_match_storyboard_assets(
            llm=llm,
            storyboard_description=storyboard.get("description", ""),
            storyboard_dialogue=storyboard.get("dialogue", ""),
            storyboard_action=storyboard.get("action", ""),
            episode_script=episode_script,
            characters=characters,
            scenes=scenes,
            props=props
        )

        await llm.close()

        # 6. 自动保存匹配结果到分镜
        storyboard["scene_id"] = matched_assets.get("scene_id", "")
        storyboard["character_ids"] = matched_assets.get("character_ids", [])
        storyboard["prop_ids"] = matched_assets.get("prop_ids", [])
        storyboard["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "storyboard", storyboard)

        return {
            **matched_assets,
            "saved": True
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to auto-match assets: {str(e)}"
        )


@router.post("/{storyboard_id}/generate-nine-grid-prompts")
async def generate_nine_grid_prompts(project_id: str, storyboard_id: str):
    """
    为九宫格分镜一次性生成图片提示词和视频提示词

    使用分镜的 description（剧本原文片段）+ 完整剧集剧本 + 已匹配资产，
    一次LLM调用同时生成 image_prompt 和 video_prompt。
    """
    from app.services import ProjectService

    try:
        # 1. 加载分镜
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            raise HTTPException(status_code=404, detail="Storyboard not found")

        # 2. 获取项目和AI配置
        project = ProjectService.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        ai_config = project.get("ai_config", {})
        llm = get_ai_service(ai_config, "llm", project_id)

        # 3. 获取完整剧集剧本
        episode_script = ""
        episode_id = storyboard.get("episode_id")
        if episode_id:
            try:
                episode = AssetService.load_asset(project_id, "episode", episode_id)
                if episode:
                    episode_script = episode.get("script", "")
            except:
                pass

        # 4. 构建资产描述
        assets_lines = []
        char_ids = storyboard.get("character_ids", [])
        scene_id = storyboard.get("scene_id")
        prop_ids = storyboard.get("prop_ids", [])

        img_idx = 1
        for cid in char_ids:
            char = AssetService.load_asset(project_id, "character", cid)
            if char:
                assets_lines.append(f"图{img_idx}（角色）：{char.get('name', '')} - {char.get('description', '')}")
                img_idx += 1

        if scene_id:
            scene = AssetService.load_asset(project_id, "scene", scene_id)
            if scene:
                assets_lines.append(f"图{img_idx}（场景）：{scene.get('name', '')} - {scene.get('description', '')}")
                img_idx += 1

        for pid in prop_ids:
            prop = AssetService.load_asset(project_id, "prop", pid)
            if prop:
                assets_lines.append(f"图{img_idx}（道具）：{prop.get('name', '')} - {prop.get('description', '')}")
                img_idx += 1

        assets_desc = "\n".join(assets_lines) if assets_lines else "（无参考资产）"

        # 5. 获取语言和风格配置
        from app.api.generation.style_presets import get_image_style_suffix
        global_style_config = normalize_global_style_config(ai_config.get("global_style_config"))
        language = global_style_config.get("prompt_language", "zh")
        image_style = global_style_config.get("image_style", {})
        style_suffix = ""
        if image_style.get("enabled", True):
            preset_id = image_style.get("preset_id", "none")
            if preset_id == "custom":
                style_suffix = image_style.get("custom_suffix", "")
            elif preset_id != "none":
                style_suffix = get_image_style_suffix(preset_id, language)

        # 6. 调用服务生成提示词
        result = await PromptService.generate_nine_grid_combined_prompts(
            llm=llm,
            description=storyboard.get("description", ""),
            episode_script=episode_script,
            assets_desc=assets_desc,
            language=language,
            style_suffix=style_suffix,
            ai_config=ai_config
        )
        await llm.close()

        # 6. 保存到分镜
        storyboard["image_prompt"] = result.get("image_prompt", "")
        storyboard["video_prompt"] = result.get("video_prompt", "")
        storyboard["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "storyboard", storyboard)

        return {
            "image_prompt": result.get("image_prompt", ""),
            "video_prompt": result.get("video_prompt", ""),
            "saved": True
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate nine-grid prompts: {str(e)}"
        )


@router.post("/{storyboard_id}/export")
async def export_storyboard(project_id: str, storyboard_id: str):
    """导出分镜到桌面（包含主图、资产主图、视频提示词）"""
    import shutil
    from pathlib import Path

    try:
        # 1. 获取项目信息
        from app.services import ProjectService
        project = ProjectService.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project_name = project.get("name", "未命名项目")

        # 2. 获取分镜信息
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            raise HTTPException(status_code=404, detail="Storyboard not found")

        sequence = storyboard.get("sequence", 1)
        video_prompt = storyboard.get("video_prompt", "")
        episode_id = storyboard.get("episode_id")

        # 2b. 查找集数编号
        episode_number = None
        if episode_id:
            import json as _json
            ep_file = _get_projects_dir() / project_id / "episodes" / f"{episode_id}.json"
            if ep_file.exists():
                with open(ep_file, "r", encoding="utf-8") as _f:
                    ep_data = _json.load(_f)
                episode_number = ep_data.get("episode_number")

        # 3. 获取用户桌面路径
        desktop_path = Path.home() / "Desktop"
        if not desktop_path.exists():
            # Windows中文系统可能是"桌面"
            desktop_path = Path.home() / "桌面"
            if not desktop_path.exists():
                raise HTTPException(status_code=500, detail="无法找到桌面路径")

        # 4. 创建项目文件夹
        export_folder = desktop_path / project_name
        export_folder.mkdir(exist_ok=True)

        # 4b. 创建集数子文件夹
        if episode_number is not None:
            episode_folder_name = f"第{episode_number}集"
            export_folder = export_folder / episode_folder_name
            export_folder.mkdir(exist_ok=True)

        # 5. 创建分镜子文件夹
        storyboard_folder = export_folder / f"分镜{sequence}"
        storyboard_folder.mkdir(exist_ok=True)

        # 6. 导出分镜主图
        primary_image = ImageService.get_primary_image(project_id, storyboard_id)
        if primary_image and primary_image.get("local_path"):
            local_path = primary_image.get("local_path")
            project_dir = _get_projects_dir() / project_id
            source_file = project_dir / "images" / "files" / local_path

            if source_file.exists():
                # 获取文件扩展名
                ext = source_file.suffix
                dest_file = storyboard_folder / f"分镜主图{ext}"
                shutil.copy2(source_file, dest_file)

        # 7. 导出关联资产的主图
        # 导出角色主图
        character_ids = storyboard.get("character_ids", [])
        for idx, char_id in enumerate(character_ids, 1):
            character = AssetService.load_asset(project_id, "character", char_id)
            if character:
                char_name = character.get("name", f"角色{idx}")
                char_image = ImageService.get_primary_image(project_id, char_id)
                if char_image and char_image.get("local_path"):
                    local_path = char_image.get("local_path")
                    source_file = project_dir / "images" / "files" / local_path
                    if source_file.exists():
                        ext = source_file.suffix
                        dest_file = storyboard_folder / f"角色-{char_name}{ext}"
                        shutil.copy2(source_file, dest_file)

        # 导出场景主图
        scene_id = storyboard.get("scene_id")
        if scene_id:
            scene = AssetService.load_asset(project_id, "scene", scene_id)
            if scene:
                scene_name = scene.get("name", "场景")
                scene_image = ImageService.get_primary_image(project_id, scene_id)
                if scene_image and scene_image.get("local_path"):
                    local_path = scene_image.get("local_path")
                    source_file = project_dir / "images" / "files" / local_path
                    if source_file.exists():
                        ext = source_file.suffix
                        dest_file = storyboard_folder / f"场景-{scene_name}{ext}"
                        shutil.copy2(source_file, dest_file)

        # 导出道具主图
        prop_ids = storyboard.get("prop_ids", [])
        for idx, prop_id in enumerate(prop_ids, 1):
            prop = AssetService.load_asset(project_id, "prop", prop_id)
            if prop:
                prop_name = prop.get("name", f"道具{idx}")
                prop_image = ImageService.get_primary_image(project_id, prop_id)
                if prop_image and prop_image.get("local_path"):
                    local_path = prop_image.get("local_path")
                    source_file = project_dir / "images" / "files" / local_path
                    if source_file.exists():
                        ext = source_file.suffix
                        dest_file = storyboard_folder / f"道具-{prop_name}{ext}"
                        shutil.copy2(source_file, dest_file)

        # 8. 导出视频提示词
        if video_prompt:
            prompt_file = storyboard_folder / "视频提示词.txt"
            with open(prompt_file, "w", encoding="utf-8") as f:
                if isinstance(video_prompt, list):
                    f.write("\n\n---\n\n".join(video_prompt))
                else:
                    f.write(video_prompt)

        return {
            "success": True,
            "export_path": str(storyboard_folder),
            "video_prompt": video_prompt,
            "message": f"已导出到桌面：{project_name}/{'第' + str(episode_number) + '集/' if episode_number is not None else ''}分镜{sequence}"
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"导出失败: {str(e)}"
        )


@router.get("/{storyboard_id}/download")
async def download_storyboard_resources(project_id: str, storyboard_id: str):
    """下载分镜资源包（zip格式，包含主图、资产主图、视频提示词）"""
    import shutil
    import zipfile
    import tempfile
    from pathlib import Path
    from fastapi.responses import FileResponse

    try:
        # 1. 获取项目信息
        from app.services import ProjectService
        project = ProjectService.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project_name = project.get("name", "未命名项目")

        # 2. 获取分镜信息
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            raise HTTPException(status_code=404, detail="Storyboard not found")

        sequence = storyboard.get("sequence", 1)
        video_prompt = storyboard.get("video_prompt", "")
        episode_id = storyboard.get("episode_id")

        # 2b. 查找集数编号
        episode_number = None
        if episode_id:
            import json as _json
            ep_file = _get_projects_dir() / project_id / "episodes" / f"{episode_id}.json"
            if ep_file.exists():
                with open(ep_file, "r", encoding="utf-8") as _f:
                    ep_data = _json.load(_f)
                episode_number = ep_data.get("episode_number")

        # 3. 创建临时目录
        temp_dir = Path(tempfile.mkdtemp())
        storyboard_folder = temp_dir / f"分镜{sequence}"
        storyboard_folder.mkdir(exist_ok=True)

        project_dir = _get_projects_dir() / project_id

        # 4. 复制分镜主图
        primary_image = ImageService.get_primary_image(project_id, storyboard_id)
        if primary_image and primary_image.get("local_path"):
            local_path = primary_image.get("local_path")
            source_file = project_dir / "images" / "files" / local_path

            if source_file.exists():
                ext = source_file.suffix
                dest_file = storyboard_folder / f"分镜主图{ext}"
                shutil.copy2(source_file, dest_file)

        # 5. 复制关联资产的主图
        # 复制角色主图
        character_ids = storyboard.get("character_ids", [])
        for idx, char_id in enumerate(character_ids, 1):
            character = AssetService.load_asset(project_id, "character", char_id)
            if character:
                char_name = character.get("name", f"角色{idx}")
                char_image = ImageService.get_primary_image(project_id, char_id)
                if char_image and char_image.get("local_path"):
                    local_path = char_image.get("local_path")
                    source_file = project_dir / "images" / "files" / local_path
                    if source_file.exists():
                        ext = source_file.suffix
                        dest_file = storyboard_folder / f"角色-{char_name}{ext}"
                        shutil.copy2(source_file, dest_file)

        # 复制场景主图
        scene_id = storyboard.get("scene_id")
        if scene_id:
            scene = AssetService.load_asset(project_id, "scene", scene_id)
            if scene:
                scene_name = scene.get("name", "场景")
                scene_image = ImageService.get_primary_image(project_id, scene_id)
                if scene_image and scene_image.get("local_path"):
                    local_path = scene_image.get("local_path")
                    source_file = project_dir / "images" / "files" / local_path
                    if source_file.exists():
                        ext = source_file.suffix
                        dest_file = storyboard_folder / f"场景-{scene_name}{ext}"
                        shutil.copy2(source_file, dest_file)

        # 复制道具主图
        prop_ids = storyboard.get("prop_ids", [])
        for idx, prop_id in enumerate(prop_ids, 1):
            prop = AssetService.load_asset(project_id, "prop", prop_id)
            if prop:
                prop_name = prop.get("name", f"道具{idx}")
                prop_image = ImageService.get_primary_image(project_id, prop_id)
                if prop_image and prop_image.get("local_path"):
                    local_path = prop_image.get("local_path")
                    source_file = project_dir / "images" / "files" / local_path
                    if source_file.exists():
                        ext = source_file.suffix
                        dest_file = storyboard_folder / f"道具-{prop_name}{ext}"
                        shutil.copy2(source_file, dest_file)

        # 6. 保存视频提示词
        if video_prompt:
            prompt_file = storyboard_folder / "视频提示词.txt"
            with open(prompt_file, "w", encoding="utf-8") as f:
                if isinstance(video_prompt, list):
                    f.write("\n\n---\n\n".join(video_prompt))
                else:
                    f.write(video_prompt)

        # 7. 创建zip文件
        zip_filename = f"{project_name}_第{episode_number}集_分镜{sequence}.zip" if episode_number else f"{project_name}_分镜{sequence}.zip"
        zip_path = temp_dir / zip_filename

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file in storyboard_folder.rglob('*'):
                if file.is_file():
                    arcname = file.relative_to(temp_dir)
                    zipf.write(file, arcname)

        # 8. 返回文件响应
        return FileResponse(
            path=str(zip_path),
            filename=zip_filename,
            media_type='application/zip',
            background=None  # 不自动删除，让系统清理临时文件
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"下载失败: {str(e)}"
        )


# ── 资产提取与匹配 ────────────────────────────────────────────────────────────

class ExtractAssetsRequest(BaseModel):
    episode_id: str


class MatchAssetsRequest(BaseModel):
    episode_id: str
    overwrite_existing: bool = False


@router.post("/extract-assets")
async def extract_assets(project_id: str, request: ExtractAssetsRequest):
    """从指定剧集的分镜内容中提取重要资产并创建到资产库"""
    try:
        project = ProjectService.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ai_config = project.get("ai_config", {})
        result = await extract_assets_from_storyboards(project_id, request.episode_id, ai_config)
        created = result["created"]
        total_created = (
            len(created["characters"]) + len(created["scenes"]) + len(created["props"])
        )
        return {
            "success": True,
            "created": created,
            "total_created": total_created,
            "skipped_count": result["skipped_count"],
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"资产提取失败: {str(e)}")


@router.post("/match-assets")
async def match_assets(project_id: str, request: MatchAssetsRequest):
    """将资产库中的资产批量匹配到指定剧集的所有分镜"""
    try:
        project = ProjectService.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ai_config = project.get("ai_config", {})
        result = await match_assets_to_storyboards(
            project_id, request.episode_id, ai_config, request.overwrite_existing
        )
        return {
            "success": True,
            "updated_count": result["updated_count"],
            "updated_storyboard_ids": result["updated_storyboard_ids"],
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"资产匹配失败: {str(e)}")
