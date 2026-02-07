from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from typing import List, Optional
from pathlib import Path

from app.services import AssetService
from app.core.config import settings

router = APIRouter(prefix="/projects/{project_id}/videos", tags=["videos"])


@router.get("")
async def list_videos(
    project_id: str,
    storyboard_id: Optional[str] = None,
    episode_id: Optional[str] = None
):
    """获取视频列表"""
    try:
        # 获取项目目录
        project_dir = settings.PROJECTS_DIR / project_id
        if not project_dir.exists():
            raise HTTPException(status_code=404, detail="Project not found")

        videos_dir = project_dir / "videos"
        if not videos_dir.exists():
            return {"videos": []}

        # 读取所有视频文件
        video_list = []
        for video_file in videos_dir.glob("*.json"):
            try:
                import json
                with open(video_file, 'r', encoding='utf-8') as f:
                    video_data = json.load(f)

                # 过滤条件
                if storyboard_id and video_data.get("storyboard_id") != storyboard_id:
                    continue
                if episode_id and video_data.get("episode_id") != episode_id:
                    continue

                video_list.append(video_data)
            except:
                continue

        # 按创建时间排序
        video_list.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return {"videos": video_list}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/file/{video_id}")
async def get_video_file(project_id: str, video_id: str):
    """获取视频文件"""
    try:
        project_dir = settings.PROJECTS_DIR / project_id
        video_json_path = project_dir / "videos" / f"{video_id}.json"

        if not video_json_path.exists():
            raise HTTPException(status_code=404, detail="Video not found")

        # 读取视频元数据
        import json
        with open(video_json_path, 'r', encoding='utf-8') as f:
            video_data = json.load(f)

        video_path = video_data.get("video_path")
        if not video_path:
            raise HTTPException(status_code=404, detail="Video file not found")

        # 如果是相对路径，转换为绝对路径
        if video_path.startswith("/"):
            video_file = Path("." + video_path)  # 假设路径相对于项目根目录
        else:
            video_file = Path(video_path)

        if not video_file.exists():
            raise HTTPException(status_code=404, detail="Video file not found on disk")

        return FileResponse(
            path=str(video_file),
            media_type="video/mp4",
            filename=f"{video_id}.mp4"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{video_id}")
async def delete_video(project_id: str, video_id: str):
    """删除视频"""
    try:
        project_dir = settings.PROJECTS_DIR / project_id
        video_json_path = project_dir / "videos" / f"{video_id}.json"

        if not video_json_path.exists():
            raise HTTPException(status_code=404, detail="Video not found")

        # 读取视频元数据以获取视频文件路径
        import json
        import os

        with open(video_json_path, 'r', encoding='utf-8') as f:
            video_data = json.load(f)

        # 删除JSON元数据文件
        video_json_path.unlink()

        # 尝试删除视频文件
        video_path = video_data.get("video_path")
        if video_path:
            if video_path.startswith("/"):
                video_file = Path("." + video_path)
            else:
                video_file = Path(video_path)

            if video_file.exists():
                video_file.unlink()

        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
