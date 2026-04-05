"""视频下载服务 - 将外部视频下载到本地"""
import json
import aiohttp
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Callable
from datetime import datetime

from app.core.config import settings
from app.core.context import get_current_data_root


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class VideoDownloadService:
    """视频下载服务"""

    # 下载状态存储（内存中，用于跟踪进度）
    _download_tasks: Dict[str, Dict] = {}

    @staticmethod
    def get_videos_dir(project_id: str) -> Path:
        """获取项目视频文件存储目录"""
        project_dir = _get_projects_dir() / project_id
        videos_dir = project_dir / "videos" / "files"
        videos_dir.mkdir(parents=True, exist_ok=True)
        return videos_dir

    @staticmethod
    def get_file_extension(url: str) -> str:
        """从URL获取文件扩展名"""
        url_lower = url.lower().split('?')[0]  # 去除查询参数
        if url_lower.endswith(('.mp4', '.webm', '.mov', '.avi')):
            return url_lower.rsplit('.', 1)[-1]
        # 默认使用 mp4
        return 'mp4'

    @staticmethod
    async def download_single_video(
        url: str,
        save_path: Path,
        timeout: int = 300
    ) -> bool:
        """下载单个视频（超时时间更长，因为视频文件较大）"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                    if response.status == 200:
                        content = await response.read()
                        save_path.write_bytes(content)
                        return True
                    return False
        except Exception as e:
            print(f"下载视频失败 {url}: {e}")
            return False

    @staticmethod
    def get_download_status(project_id: str) -> Dict:
        """获取项目的视频下载状态"""
        return VideoDownloadService._download_tasks.get(project_id, {
            "status": "idle",
            "total": 0,
            "downloaded": 0,
            "failed": 0,
            "current_video": "",
            "errors": []
        })

    @staticmethod
    def set_download_status(project_id: str, status: Dict):
        """设置项目的视频下载状态"""
        VideoDownloadService._download_tasks[project_id] = status

    @staticmethod
    def list_videos(project_id: str, episode_id: Optional[str] = None) -> List[Dict]:
        """获取项目的所有视频记录"""
        project_dir = _get_projects_dir() / project_id
        videos_dir = project_dir / "videos"

        if not videos_dir.exists():
            return []

        videos = []
        for file_path in videos_dir.glob("*.json"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    video = json.load(f)
                    # 如果指定了episode_id，过滤
                    if episode_id and video.get("episode_id") != episode_id:
                        continue
                    videos.append(video)
            except Exception as e:
                print(f"读取视频记录失败 {file_path}: {e}")

        return videos

    @staticmethod
    async def download_all_videos(
        project_id: str,
        episode_id: Optional[str] = None,
        progress_callback: Optional[Callable] = None
    ) -> Dict:
        """下载项目的所有视频

        Args:
            project_id: 项目ID
            episode_id: 可选的剧集ID，仅下载该剧集的视频
            progress_callback: 进度回调函数

        Returns:
            下载结果统计
        """
        # 初始化状态
        VideoDownloadService.set_download_status(project_id, {
            "status": "running",
            "total": 0,
            "downloaded": 0,
            "failed": 0,
            "current_video": "",
            "errors": [],
            "started_at": datetime.now().isoformat()
        })

        try:
            # 获取所有视频记录
            all_videos = VideoDownloadService.list_videos(project_id, episode_id)

            # 过滤出已完成且有外部URL的视频
            videos_to_download = [
                video for video in all_videos
                if video.get("status") == "completed"
                and video.get("video_path")
                and video.get("video_path", "").startswith(("http://", "https://"))
                and not video.get("is_downloaded")  # 跳过已下载的
            ]

            total = len(videos_to_download)
            status = VideoDownloadService.get_download_status(project_id)
            status["total"] = total
            VideoDownloadService.set_download_status(project_id, status)

            if total == 0:
                status["status"] = "completed"
                VideoDownloadService.set_download_status(project_id, status)
                return {
                    "success": True,
                    "total": 0,
                    "downloaded": 0,
                    "failed": 0,
                    "message": "没有需要下载的视频"
                }

            videos_dir = VideoDownloadService.get_videos_dir(project_id)

            # 并发下载（限制并发数为3，因为视频文件较大）
            semaphore = asyncio.Semaphore(3)

            async def download_with_semaphore(video: Dict):
                async with semaphore:
                    video_id = video["video_id"]
                    url = video["video_path"]

                    # 更新当前状态
                    status = VideoDownloadService.get_download_status(project_id)
                    status["current_video"] = video_id[:8]
                    VideoDownloadService.set_download_status(project_id, status)

                    if progress_callback:
                        await progress_callback(status)

                    # 确定保存路径
                    ext = VideoDownloadService.get_file_extension(url)
                    filename = f"{video_id}.{ext}"
                    save_path = videos_dir / filename

                    # 如果文件已存在，跳过下载但更新元数据
                    if save_path.exists():
                        VideoDownloadService._update_video_metadata(project_id, video_id, filename)
                        status = VideoDownloadService.get_download_status(project_id)
                        status["downloaded"] += 1
                        VideoDownloadService.set_download_status(project_id, status)
                        return {"video_id": video_id, "success": True, "skipped": True}

                    # 下载视频
                    success = await VideoDownloadService.download_single_video(url, save_path)

                    if success:
                        # 更新视频元数据
                        VideoDownloadService._update_video_metadata(project_id, video_id, filename)

                        status = VideoDownloadService.get_download_status(project_id)
                        status["downloaded"] += 1
                        VideoDownloadService.set_download_status(project_id, status)

                        if progress_callback:
                            await progress_callback(status)

                        return {"video_id": video_id, "success": True, "skipped": False}
                    else:
                        status = VideoDownloadService.get_download_status(project_id)
                        status["failed"] += 1
                        status["errors"].append(f"{video_id[:8]}: 下载失败")
                        VideoDownloadService.set_download_status(project_id, status)

                        if progress_callback:
                            await progress_callback(status)

                        return {"video_id": video_id, "success": False, "error": "下载失败"}

            # 执行所有下载任务
            results = await asyncio.gather(*[download_with_semaphore(video) for video in videos_to_download])

            # 最终状态
            downloaded_count = sum(1 for r in results if r.get("success"))
            failed_count = sum(1 for r in results if not r.get("success"))

            status = VideoDownloadService.get_download_status(project_id)
            status["status"] = "completed"
            status["current_video"] = ""
            status["completed_at"] = datetime.now().isoformat()
            VideoDownloadService.set_download_status(project_id, status)

            return {
                "success": True,
                "total": total,
                "downloaded": downloaded_count,
                "failed": failed_count,
                "newly_downloaded": downloaded_count - sum(1 for r in results if r.get("skipped")),
                "errors": status["errors"][:10]  # 只返回前10个错误
            }

        except Exception as e:
            status = VideoDownloadService.get_download_status(project_id)
            status["status"] = "error"
            status["error"] = str(e)
            VideoDownloadService.set_download_status(project_id, status)

            return {
                "success": False,
                "error": str(e)
            }

    @staticmethod
    def _update_video_metadata(project_id: str, video_id: str, local_path: str):
        """更新视频元数据，添加本地路径"""
        project_dir = _get_projects_dir() / project_id
        file_path = project_dir / "videos" / f"{video_id}.json"

        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            data["local_path"] = local_path
            data["is_downloaded"] = True
            data["downloaded_at"] = datetime.now().isoformat()

            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

    @staticmethod
    def get_download_statistics(project_id: str, episode_id: Optional[str] = None) -> Dict:
        """获取项目视频下载统计"""
        all_videos = VideoDownloadService.list_videos(project_id, episode_id)

        # 只统计已完成的视频
        completed_videos = [v for v in all_videos if v.get("status") == "completed"]
        total = len(completed_videos)
        downloaded = sum(1 for v in completed_videos if v.get("is_downloaded"))
        has_external_url = sum(
            1 for v in completed_videos
            if v.get("video_path") and v.get("video_path", "").startswith(("http://", "https://"))
        )

        return {
            "total_videos": total,
            "downloaded_videos": downloaded,
            "external_videos": has_external_url,
            "local_only_videos": total - has_external_url,
            "download_progress": round(downloaded / has_external_url * 100, 1) if has_external_url > 0 else 100
        }

    @staticmethod
    async def download_and_save_video(
        project_id: str,
        video_id: str,
        url: str
    ) -> bool:
        """
        下载单个视频并更新元数据（用于生成成功后自动下载）

        Args:
            project_id: 项目ID
            video_id: 视频ID
            url: 视频URL

        Returns:
            bool: 下载是否成功
        """
        try:
            # 1. 获取视频存储目录
            videos_dir = VideoDownloadService.get_videos_dir(project_id)

            # 2. 确定文件扩展名和保存路径
            ext = VideoDownloadService.get_file_extension(url)
            filename = f"{video_id}.{ext}"
            save_path = videos_dir / filename

            # 3. 下载视频
            success = await VideoDownloadService.download_single_video(url, save_path)

            if success:
                # 4. 更新元数据
                VideoDownloadService._update_video_metadata(project_id, video_id, filename)
                print(f"[自动下载] 成功下载视频 {video_id}: {filename}")
                return True
            else:
                print(f"[自动下载] 下载视频失败 {video_id}")
                return False

        except Exception as e:
            print(f"[自动下载] 下载视频时出错 {video_id}: {e}")
            return False
