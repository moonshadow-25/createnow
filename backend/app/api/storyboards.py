from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
from datetime import datetime
import os

from app.services import AssetService, PromptService, get_ai_service
from app.services.asset_service import ImageService
from app.services.video_service import VideoService
from app.models.project import Storyboard
from app.core.config import settings

router = APIRouter(prefix="/projects/{project_id}/storyboards", tags=["storyboards"])


class StoryboardCreate(BaseModel):
    episode_id: str
    sequence: int
    description: str
    character_ids: List[str] = []
    scene_id: str = None
    prop_ids: List[str] = []
    camera_angle: str = None
    shot_type: str = None
    dialogue: str = ""
    action: str = ""
    image_prompt: str = None


class StoryboardUpdate(BaseModel):
    description: str = None
    character_ids: List[str] = None
    scene_id: str = None
    prop_ids: List[str] = None
    camera_angle: str = None
    shot_type: str = None
    dialogue: str = None
    action: str = None
    image_prompt: str = None


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
    llm = get_ai_service(ai_config, "llm")

    try:
        storyboards = await PromptService.generate_storyboard_descriptions(
            llm, request.script
        )
        await llm.close()

        print(f"[DEBUG] Generated {len(storyboards)} storyboards")

        # 保存所有分镜
        results = []
        for sb_data in storyboards:
            sb_data["episode_id"] = request.episode_id
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


@router.get("/episode/{episode_id}", response_model=List[dict])
async def list_episode_storyboards(project_id: str, episode_id: str):
    """列出剧集的所有分镜（包含主图URL）"""
    storyboards = AssetService.list_assets(project_id, "storyboard")
    episode_storyboards = [
        sb for sb in storyboards if sb.get("episode_id") == episode_id
    ]

    # 批量获取所有分镜的主图
    asset_ids = [sb["asset_id"] for sb in episode_storyboards]
    primary_images = ImageService.get_primary_images_batch(project_id, asset_ids)

    # 为每个分镜添加主图URL
    for sb in episode_storyboards:
        primary_image = primary_images.get(sb["asset_id"])
        if primary_image:
            # 优先使用本地路径
            if primary_image.get("local_path"):
                sb["primary_image_url"] = f"/api/projects/{project_id}/images/files/{primary_image['local_path']}"
            else:
                sb["primary_image_url"] = primary_image.get("image_path")
        else:
            sb["primary_image_url"] = None

    # 按sequence排序后返回
    episode_storyboards.sort(key=lambda x: x.get("sequence", 0))
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
            str(settings.PROJECTS_DIR),
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
