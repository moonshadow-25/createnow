"""
视频导出服务 - 将分镜视频按顺序导出
"""
import json
import logging
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import aiohttp

from app.core.config import settings
from app.core.context import get_current_data_root

logger = logging.getLogger(__name__)

# 导出状态存储（内存中，按项目ID）
_export_status: Dict[str, Dict] = {}


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class VideoExportService:
    """视频导出服务"""

    @staticmethod
    def get_export_status(project_id: str) -> Dict:
        """获取导出状态"""
        return _export_status.get(project_id, {
            "status": "idle",
            "progress": 0,
            "current_step": "",
            "errors": [],
            "download_url": None
        })

    @staticmethod
    def _update_status(project_id: str, **kwargs):
        """更新导出状态"""
        if project_id not in _export_status:
            _export_status[project_id] = {
                "status": "idle",
                "progress": 0,
                "current_step": "",
                "errors": [],
                "download_url": None
            }
        _export_status[project_id].update(kwargs)

    @staticmethod
    async def download_video(url: str, dest_path: str) -> bool:
        """下载视频到本地"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=300)) as response:
                    if response.status == 200:
                        with open(dest_path, 'wb') as f:
                            async for chunk in response.content.iter_chunked(8192):
                                f.write(chunk)
                        return True
                    else:
                        logger.error(f"Download failed with status {response.status}: {url}")
                        return False
        except Exception as e:
            logger.error(f"Error downloading video: {e}")
            return False

    @staticmethod
    def _update_video_local_path(project_id: str, video_id: str, local_path: str):
        """更新视频的本地路径和下载状态"""
        project_dir = _get_projects_dir() / project_id
        file_path = project_dir / "videos" / f"{video_id}.json"

        if file_path.exists():
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                data["local_path"] = local_path
                data["is_downloaded"] = True
                data["downloaded_at"] = datetime.now().isoformat()

                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                logger.info(f"Updated video metadata for {video_id}: local_path={local_path}")
            except Exception as e:
                logger.error(f"Failed to update video metadata for {video_id}: {e}")

    @staticmethod
    async def export_episode_videos(project_id: str, episode_id: str, storyboard_ids: Optional[List[str]] = None) -> Optional[str]:
        """
        导出剧集的所有分镜视频

        Returns:
            导出的 zip 文件名（相对路径），失败返回 None
        """
        VideoExportService._update_status(
            project_id,
            status="exporting",
            progress=0,
            current_step="初始化导出...",
            errors=[],
            download_url=None
        )

        try:
            # 1. 获取该剧集的所有分镜
            VideoExportService._update_status(project_id, current_step="获取分镜列表...")

            storyboards_dir = _get_projects_dir() / project_id / "storyboards"
            videos_dir = _get_projects_dir() / project_id / "videos"
            export_dir = _get_projects_dir() / project_id / "exports"
            export_dir.mkdir(exist_ok=True)

            if not storyboards_dir.exists():
                VideoExportService._update_status(
                    project_id,
                    status="error",
                    errors=["分镜目录不存在"]
                )
                return None

            # 加载分镜并按 sequence 排序
            all_storyboards = []
            for sb_file in storyboards_dir.glob("*.json"):
                try:
                    with open(sb_file, 'r', encoding='utf-8') as f:
                        sb = json.load(f)
                        all_storyboards.append(sb)
                except Exception as e:
                    logger.error(f"Error loading storyboard {sb_file}: {e}")

            # 根据参数过滤分镜
            if storyboard_ids:
                # 如果指定了分镜 ID，只导出这些分镜
                storyboards = [sb for sb in all_storyboards if sb.get('asset_id') in storyboard_ids]
                if not storyboards:
                    VideoExportService._update_status(
                        project_id,
                        status="error",
                        errors=["未找到指定的分镜"]
                    )
                    return None
            else:
                # 否则，导出该剧集的所有分镜
                storyboards = [sb for sb in all_storyboards if sb.get('episode_id') == episode_id]
                if not storyboards:
                    VideoExportService._update_status(
                        project_id,
                        status="error",
                        errors=["该剧集没有分镜"]
                    )
                    return None

            storyboards.sort(key=lambda x: x.get('sequence', 0))

            VideoExportService._update_status(project_id, progress=10)

            # 2. 获取每个分镜的视频
            VideoExportService._update_status(project_id, current_step="查找分镜视频...")

            # 加载所有视频记录
            all_videos = []
            if videos_dir.exists():
                for video_file in videos_dir.glob("*.json"):
                    try:
                        with open(video_file, 'r', encoding='utf-8') as f:
                            video = json.load(f)
                            if video.get('status') == 'completed':
                                all_videos.append(video)
                    except Exception as e:
                        logger.error(f"Error loading video {video_file}: {e}")

            # 为每个分镜找到对应的视频
            storyboard_videos = []
            errors = []

            for sb in storyboards:
                sb_id = sb.get('asset_id')
                sb_videos = [v for v in all_videos if v.get('storyboard_id') == sb_id]

                if not sb_videos:
                    errors.append(f"分镜 {sb.get('sequence')} 没有已完成的视频")
                    continue

                # 优先选择主视频
                primary_video = next((v for v in sb_videos if v.get('is_primary')), None)
                if primary_video:
                    storyboard_videos.append((sb, primary_video))
                else:
                    # 没有主视频，选择最新创建的（降序排序）
                    sb_videos.sort(key=lambda x: x.get('created_at', ''), reverse=True)
                    storyboard_videos.append((sb, sb_videos[0]))

            if not storyboard_videos:
                VideoExportService._update_status(
                    project_id,
                    status="error",
                    errors=["没有找到可导出的视频"] + errors
                )
                return None

            VideoExportService._update_status(project_id, progress=20, errors=errors)

            # 3. 创建临时目录并准备视频文件
            VideoExportService._update_status(project_id, current_step="准备视频文件...")

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            temp_dir = export_dir / f"temp_{timestamp}"
            temp_dir.mkdir(exist_ok=True)

            video_files = []  # (sequence, local_path, original_name)
            total_videos = len(storyboard_videos)
            video_files_dir = _get_projects_dir() / project_id / "videos" / "files"

            for idx, (sb, video) in enumerate(storyboard_videos):
                sequence = sb.get('sequence', idx + 1)
                video_path = video.get('video_path', '')
                local_path = video.get('local_path', '')

                VideoExportService._update_status(
                    project_id,
                    current_step=f"处理视频 {idx + 1}/{total_videos}...",
                    progress=20 + int(60 * idx / total_videos)
                )

                # 确定源文件路径
                source_path = None

                # 优先使用本地文件
                if local_path:
                    local_file = video_files_dir / local_path
                    if local_file.exists():
                        source_path = str(local_file)

                # 如果没有本地文件，尝试下载
                if not source_path and video_path:
                    if video_path.startswith(('http://', 'https://')):
                        # 下载到永久目录（videos/files/）
                        video_id = video.get('video_id')
                        video_files_dir.mkdir(parents=True, exist_ok=True)
                        permanent_video_path = video_files_dir / f"{video_id}.mp4"

                        if await VideoExportService.download_video(video_path, str(permanent_video_path)):
                            source_path = str(permanent_video_path)
                            # 更新视频元数据
                            VideoExportService._update_video_local_path(
                                project_id, video_id, f"{video_id}.mp4"
                            )
                            logger.info(f"Downloaded and saved video {video_id} permanently")
                        else:
                            errors.append(f"分镜 {sequence} 的视频下载失败")
                            continue
                    else:
                        # 本地路径
                        if Path(video_path).exists():
                            source_path = video_path

                if not source_path:
                    errors.append(f"分镜 {sequence} 的视频文件不存在")
                    continue

                # 复制到临时目录并按序号命名
                dest_filename = f"{sequence:02d}_S{sequence}.mp4"
                dest_path = temp_dir / dest_filename
                shutil.copy2(source_path, dest_path)
                video_files.append((sequence, str(dest_path), dest_filename))

            if not video_files:
                VideoExportService._update_status(
                    project_id,
                    status="error",
                    errors=["没有可用的视频文件"] + errors
                )
                # 清理临时目录
                shutil.rmtree(temp_dir, ignore_errors=True)
                return None

            # 按序号排序
            video_files.sort(key=lambda x: x[0])

            VideoExportService._update_status(project_id, progress=80, errors=errors)

            # 4. 打包成 zip
            VideoExportService._update_status(project_id, current_step="打包文件...")

            zip_filename = f"export_{episode_id}_{timestamp}.zip"
            zip_path = export_dir / zip_filename

            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for _, _, filename in video_files:
                    file_path = temp_dir / filename
                    if file_path.exists():
                        zf.write(file_path, filename)

            VideoExportService._update_status(project_id, progress=95)

            # 5. 清理临时文件
            VideoExportService._update_status(project_id, current_step="清理临时文件...")
            shutil.rmtree(temp_dir, ignore_errors=True)

            # 6. 完成
            download_url = f"/api/projects/{project_id}/generate/videos/export-download/{zip_filename}"
            VideoExportService._update_status(
                project_id,
                status="completed",
                progress=100,
                current_step="导出完成",
                download_url=download_url,
                errors=errors
            )

            return zip_filename

        except Exception as e:
            logger.error(f"Error exporting videos: {e}")
            VideoExportService._update_status(
                project_id,
                status="error",
                errors=[f"导出失败: {str(e)}"]
            )
            return None

    @staticmethod
    def cleanup_old_exports(project_id: str, max_age_hours: int = 24):
        """清理旧的导出文件"""
        export_dir = _get_projects_dir() / project_id / "exports"
        if not export_dir.exists():
            return

        now = datetime.now()
        for file in export_dir.glob("export_*.zip"):
            try:
                file_time = datetime.fromtimestamp(file.stat().st_mtime)
                age_hours = (now - file_time).total_seconds() / 3600
                if age_hours > max_age_hours:
                    file.unlink()
                    logger.info(f"Cleaned up old export: {file}")
            except Exception as e:
                logger.error(f"Error cleaning up export {file}: {e}")
