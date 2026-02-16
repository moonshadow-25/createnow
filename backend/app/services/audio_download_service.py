"""音频下载服务 - 下载和保存音频文件"""
import aiohttp
import logging
from pathlib import Path
from typing import Optional
from app.core.config import settings
from app.services.audio_service import AudioService

logger = logging.getLogger(__name__)


class AudioDownloadService:
    """音频下载服务"""

    @staticmethod
    def get_audios_files_dir(project_id: str) -> Path:
        """获取项目音频文件存储目录"""
        audios_dir = AudioService.get_audios_dir(project_id)
        files_dir = audios_dir / "files"
        files_dir.mkdir(parents=True, exist_ok=True)
        return files_dir

    @staticmethod
    def get_file_extension(format: str) -> str:
        """获取音频文件扩展名"""
        format_map = {
            "mp3": "mp3",
            "wav": "wav",
            "opus": "opus",
            "aac": "aac",
            "flac": "flac",
            "pcm": "pcm"
        }
        return format_map.get(format.lower(), "mp3")

    @staticmethod
    async def download_single_audio(
        url: str,
        save_path: Path,
        timeout: int = 60
    ) -> bool:
        """从URL下载单个音频文件"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                    if response.status == 200:
                        content = await response.read()
                        save_path.write_bytes(content)
                        logger.info(f"[AudioDownload] 下载成功: {save_path}")
                        return True
                    else:
                        logger.error(f"[AudioDownload] 下载失败: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"[AudioDownload] 下载异常: {e}")
            return False

    @staticmethod
    async def save_audio_data(
        project_id: str,
        audio_id: str,
        audio_data: bytes,
        format: str = "mp3"
    ) -> Optional[str]:
        """
        保存音频二进制数据到文件

        Returns:
            str: 相对路径（相对于audios/files/目录），如 "audio_xxx.mp3"
        """
        try:
            files_dir = AudioDownloadService.get_audios_files_dir(project_id)
            extension = AudioDownloadService.get_file_extension(format)
            filename = f"{audio_id}.{extension}"
            file_path = files_dir / filename

            # 写入文件
            file_path.write_bytes(audio_data)
            logger.info(f"[AudioDownload] 保存音频数据: {file_path}, 大小: {len(audio_data)} bytes")

            # 返回相对路径
            return filename

        except Exception as e:
            logger.error(f"[AudioDownload] 保存音频数据失败: {e}")
            return None

    @staticmethod
    async def download_and_save_audio(
        project_id: str,
        audio_id: str,
        url: str,
        format: str = "mp3"
    ) -> Optional[str]:
        """
        下载音频URL并保存到本地

        Returns:
            str: 相对路径（相对于audios/files/目录）
        """
        try:
            files_dir = AudioDownloadService.get_audios_files_dir(project_id)
            extension = AudioDownloadService.get_file_extension(format)
            filename = f"{audio_id}.{extension}"
            file_path = files_dir / filename

            # 下载文件
            success = await AudioDownloadService.download_single_audio(url, file_path)

            if success:
                # 更新音频记录
                audio = AudioService.get_audio(project_id, audio_id)
                if audio:
                    audio["local_path"] = filename
                    AudioService.save_generation_record(project_id, audio)
                    logger.info(f"[AudioDownload] 更新音频记录: {audio_id}, local_path: {filename}")

                return filename
            else:
                return None

        except Exception as e:
            logger.error(f"[AudioDownload] 下载保存失败: {e}")
            return None
