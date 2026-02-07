"""
Generation API - 下载相关端点（图片下载、视频下载、视频导出）
"""

import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings
from .models import VideoExportRequest, JianyingExportRequest

logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== 视频下载相关 API ====================

@router.post("/videos/download-all")
async def download_all_videos(project_id: str, episode_id: Optional[str] = None):
    """一键下载所有视频到本地"""
    from app.services import ProjectService
    from app.services.video_download_service import VideoDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 异步执行下载任务
    asyncio.create_task(
        VideoDownloadService.download_all_videos(project_id, episode_id)
    )

    return {
        "success": True,
        "message": "视频下载任务已启动"
    }


@router.get("/videos/download-status")
async def get_video_download_status(project_id: str):
    """获取视频下载状态"""
    from app.services import ProjectService
    from app.services.video_download_service import VideoDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = VideoDownloadService.get_download_status(project_id)
    statistics = VideoDownloadService.get_download_statistics(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": statistics,
        "current": status.get("current_video", ""),
        "errors": status.get("errors", [])[:10]
    }


@router.get("/videos/download-statistics")
async def get_video_download_statistics(project_id: str, episode_id: Optional[str] = None):
    """获取视频下载统计"""
    from app.services import ProjectService
    from app.services.video_download_service import VideoDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return VideoDownloadService.get_download_statistics(project_id, episode_id)


# ==================== 视频导出相关 API ====================

@router.post("/videos/export")
async def export_episode_videos(project_id: str, request: VideoExportRequest):
    """导出剧集的所有分镜视频（按顺序命名并拼接）

    可选择性导出：
    - 如果提供 storyboard_ids，则只导出指定的分镜
    - 如果不提供，则导出该剧集的所有分镜
    """
    from app.services import ProjectService
    from app.services.video_export_service import VideoExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 清理旧的导出文件
    VideoExportService.cleanup_old_exports(project_id)

    # 异步执行导出任务
    asyncio.create_task(
        VideoExportService.export_episode_videos(
            project_id,
            request.episode_id,
            storyboard_ids=request.storyboard_ids
        )
    )

    count_msg = f"{len(request.storyboard_ids)} 个" if request.storyboard_ids else "全部"
    return {
        "success": True,
        "message": f"视频导出任务已启动（{count_msg}分镜）"
    }


@router.get("/videos/export-status")
async def get_video_export_status(project_id: str):
    """获取视频导出状态"""
    from app.services import ProjectService
    from app.services.video_export_service import VideoExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = VideoExportService.get_export_status(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": status.get("progress", 0),
        "current_step": status.get("current_step", ""),
        "download_url": status.get("download_url"),
        "errors": status.get("errors", [])[:10]
    }


@router.get("/videos/export-download/{filename}")
async def download_export_file(project_id: str, filename: str):
    """下载导出的 zip 文件"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 验证文件名格式，防止路径遍历
    if not filename.startswith("export_") or not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    export_path = settings.PROJECTS_DIR / project_id / "exports" / filename
    if not export_path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")

    return FileResponse(
        path=str(export_path),
        filename=filename,
        media_type="application/zip"
    )


# ==================== 图片下载相关 API ====================

@router.post("/images/download-all")
async def download_all_images(project_id: str):
    """一键下载所有图片到本地"""
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 异步执行下载任务
    asyncio.create_task(
        ImageDownloadService.download_all_images(project_id)
    )

    return {
        "success": True,
        "message": "下载任务已启动"
    }


@router.get("/images/download-status")
async def get_download_status(project_id: str):
    """获取图片下载状态"""
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = ImageDownloadService.get_download_status(project_id)
    statistics = ImageDownloadService.get_download_statistics(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": statistics,
        "current": status.get("current_image", ""),
        "errors": status.get("errors", [])[:10]
    }


@router.get("/images/download-statistics")
async def get_download_statistics(project_id: str):
    """获取图片下载统计"""
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return ImageDownloadService.get_download_statistics(project_id)

# ==================== 剪映导出相关 API ====================

@router.get("/videos/jiaying-projects")
async def get_jiaying_projects(project_id: str):
    """获取剪映中的现有项目列表"""
    import json
    from app.services import ProjectService
    from app.services.jiaying_export_service import JianyingExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 扫描剪映素材库
    jiaying_path = JianyingExportService.detect_jiaying_path()

    if not jiaying_path:
        return {
            "success": False,
            "message": "未检测到剪映安装",
            "projects": []
        }

    # 读取剪映项目列表
    projects = []
    try:
        for project_dir in jiaying_path.iterdir():
            if project_dir.is_dir():
                meta_file = project_dir / "draft_meta_info.json"
                if meta_file.exists():
                    with open(meta_file, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        projects.append({
                            "id": meta.get("draft_id"),
                            "name": meta.get("draft_name", "未命名项目"),
                            "create_time": meta.get("create_time", 0),
                            "update_time": meta.get("update_time", 0),
                        })

        # 按更新时间排序（最新的在前）
        projects.sort(key=lambda x: x.get("update_time", 0), reverse=True)

    except Exception as e:
        logger.error(f"Failed to read jiaying projects: {e}")

    return {
        "success": True,
        "projects": projects
    }


@router.post("/videos/export-to-jiaying")
async def export_to_jiaying(project_id: str, request: JianyingExportRequest):
    """导出到剪映"""
    from app.services import ProjectService
    from app.services.jiaying_export_service import JianyingExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 验证参数
    if request.mode == "new" and not request.project_name:
        raise HTTPException(status_code=400, detail="创建新项目时必须提供项目名")

    if request.mode == "existing" and not request.existing_project_id:
        raise HTTPException(status_code=400, detail="导入到现有项目时必须提供项目ID")

    # 异步执行导出任务
    asyncio.create_task(
        JianyingExportService.export_to_jiaying(
            project_id,
            request.episode_id,
            storyboard_ids=request.storyboard_ids,
            mode=request.mode,
            project_name=request.project_name,
            existing_project_id=request.existing_project_id
        )
    )

    return {
        "success": True,
        "message": "剪映导出任务已启动"
    }


@router.get("/videos/jiaying-export-status")
async def get_jiaying_export_status(project_id: str):
    """获取剪映导出状态"""
    from app.services import ProjectService
    from app.services.jiaying_export_service import JianyingExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = JianyingExportService.get_export_status(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": status.get("progress", 0),
        "current_step": status.get("current_step", ""),
        "method": status.get("method"),
        "path": status.get("path"),
        "message": status.get("message", ""),
        "errors": status.get("errors", [])
    }
