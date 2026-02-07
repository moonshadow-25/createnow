import os
import json
import subprocess
from typing import Optional
from uuid import uuid4
from datetime import datetime
from ..core.config import settings


class VideoService:
    """视频处理服务"""

    @staticmethod
    def get_primary_video(project_id: str, storyboard_id: str) -> Optional[dict]:
        """
        获取分镜的视频（用于提取帧）

        逻辑：
        1. 优先返回主视频（is_primary=true）且有 local_path
        2. 如果没有主视频，返回最新的有 local_path 的视频
        """
        videos_dir = os.path.join(settings.DATA_DIR, "projects", project_id, "videos")

        if not os.path.exists(videos_dir):
            return None

        # 加载所有视频记录
        video_files = [f for f in os.listdir(videos_dir) if f.endswith('.json')]

        primary_video = None
        all_videos = []

        for video_file in video_files:
            video_path = os.path.join(videos_dir, video_file)
            try:
                with open(video_path, 'r', encoding='utf-8') as f:
                    video_data = json.load(f)

                    # 只考虑属于该分镜且有本地文件的视频
                    if (video_data.get("storyboard_id") == storyboard_id and
                        video_data.get("local_path")):

                        # 如果是主视频，直接记录
                        if video_data.get("is_primary"):
                            primary_video = video_data

                        all_videos.append(video_data)

            except Exception as e:
                print(f"Error reading video file {video_file}: {e}")
                continue

        # 优先返回主视频
        if primary_video:
            return primary_video

        # 如果没有主视频，返回最新的
        if all_videos:
            all_videos.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return all_videos[0]

        return None

    @staticmethod
    def check_ffmpeg_installed() -> bool:
        """检查 FFmpeg 是否已安装"""
        try:
            result = subprocess.run(
                ['ffmpeg', '-version'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    @staticmethod
    def extract_last_frame(video_path: str, project_id: str) -> str:
        """
        使用 FFmpeg 提取视频最后一帧

        Args:
            video_path: 视频文件完整路径
            project_id: 项目ID

        Returns:
            str: 保存的图片相对路径 (storyboard/{filename})
        """
        # 检查 FFmpeg 是否安装
        if not VideoService.check_ffmpeg_installed():
            raise RuntimeError(
                "FFmpeg is not installed. Please install FFmpeg:\n"
                "Windows: choco install ffmpeg or download from https://ffmpeg.org/\n"
                "Mac: brew install ffmpeg\n"
                "Linux: sudo apt-get install ffmpeg"
            )

        # 检查视频文件是否存在
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # 生成输出文件路径
        image_id = str(uuid4())
        filename = f"{image_id}.png"

        # 创建目录（如果不存在）
        images_dir = os.path.join(
            settings.DATA_DIR,
            "projects",
            project_id,
            "images",
            "files",
            "storyboard"
        )
        os.makedirs(images_dir, exist_ok=True)

        output_path = os.path.join(images_dir, filename)

        # 使用 FFmpeg 提取最后一帧
        # -sseof -1: 从结尾前1秒开始
        # -update 1: 只输出一帧
        # -q:v 1: 高质量输出
        try:
            command = [
                'ffmpeg',
                '-sseof', '-1',           # 从视频结尾前1秒开始
                '-i', video_path,         # 输入文件
                '-update', '1',           # 只输出一帧
                '-q:v', '1',              # 高质量（1-31，1最高）
                '-frames:v', '1',         # 只提取1帧
                '-y',                     # 覆盖输出文件
                output_path
            ]

            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=30  # 30秒超时
            )

            if result.returncode != 0:
                raise RuntimeError(
                    f"FFmpeg failed to extract frame:\n"
                    f"Command: {' '.join(command)}\n"
                    f"Error: {result.stderr}"
                )

            # 验证输出文件是否创建
            if not os.path.exists(output_path):
                raise RuntimeError("FFmpeg completed but output file was not created")

            # 验证文件大小（至少应该有一些内容）
            if os.path.getsize(output_path) < 1024:  # 小于1KB可能有问题
                raise RuntimeError("Output file is too small, extraction may have failed")

            return f"storyboard/{filename}"

        except subprocess.TimeoutExpired:
            raise RuntimeError("FFmpeg extraction timed out (>30 seconds)")
        except Exception as e:
            # 清理可能创建的不完整文件
            if os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except:
                    pass
            raise RuntimeError(f"Failed to extract last frame: {str(e)}")

    @staticmethod
    def get_video_info(video_path: str) -> dict:
        """
        获取视频信息（可选功能，用于调试和验证）

        Args:
            video_path: 视频文件完整路径

        Returns:
            dict: 视频信息（时长、分辨率、格式等）
        """
        try:
            command = [
                'ffprobe',
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                video_path
            ]

            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                return json.loads(result.stdout)
            else:
                return {}

        except Exception as e:
            print(f"Error getting video info: {e}")
            return {}
