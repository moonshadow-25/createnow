"""音频服务 - 管理音频生成记录"""
import json
from pathlib import Path
from typing import Dict, List, Optional
from app.core.config import settings
from app.models.project import AudioGeneration


class AudioService:
    """音频生成服务"""

    @staticmethod
    def get_audios_dir(project_id: str) -> Path:
        """获取项目音频存储目录"""
        project_dir = settings.PROJECTS_DIR / project_id
        audios_dir = project_dir / "audios"
        audios_dir.mkdir(parents=True, exist_ok=True)

        # 创建files子目录存放音频文件
        files_dir = audios_dir / "files"
        files_dir.mkdir(exist_ok=True)

        return audios_dir

    @staticmethod
    def save_generation_record(project_id: str, record: dict) -> dict:
        """保存音频生成记录"""
        audios_dir = AudioService.get_audios_dir(project_id)
        audio_id = record.get("audio_id")

        if not audio_id:
            from uuid import uuid4
            audio_id = str(uuid4())
            record["audio_id"] = audio_id

        record_file = audios_dir / f"{audio_id}.json"
        with open(record_file, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        return record

    @staticmethod
    def get_audio(project_id: str, audio_id: str) -> Optional[dict]:
        """获取单个音频记录"""
        audios_dir = AudioService.get_audios_dir(project_id)
        audio_file = audios_dir / f"{audio_id}.json"

        if not audio_file.exists():
            return None

        with open(audio_file, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def list_audios(project_id: str, storyboard_id: Optional[str] = None, episode_id: Optional[str] = None, character_id: Optional[str] = None) -> List[dict]:
        """列出音频记录"""
        audios_dir = AudioService.get_audios_dir(project_id)
        if not audios_dir.exists():
            return []

        audios = []
        for audio_file in audios_dir.glob("*.json"):
            try:
                with open(audio_file, "r", encoding="utf-8") as f:
                    audio = json.load(f)

                    # 过滤条件
                    if storyboard_id and audio.get("storyboard_id") != storyboard_id:
                        continue
                    if episode_id and audio.get("episode_id") != episode_id:
                        continue
                    if character_id and audio.get("character_id") != character_id:
                        continue

                    audios.append(audio)
            except Exception as e:
                print(f"Error reading audio file {audio_file}: {e}")

        # 按创建时间倒序排列
        audios.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return audios

    @staticmethod
    def delete_audio(project_id: str, audio_id: str) -> bool:
        """删除音频记录及文件"""
        audios_dir = AudioService.get_audios_dir(project_id)
        audio_file = audios_dir / f"{audio_id}.json"

        if not audio_file.exists():
            return False

        # 读取记录获取文件路径
        try:
            with open(audio_file, "r", encoding="utf-8") as f:
                audio = json.load(f)

            # 删除本地文件
            local_path = audio.get("local_path")
            if local_path:
                files_dir = audios_dir / "files"
                audio_file_path = files_dir / local_path
                if audio_file_path.exists():
                    audio_file_path.unlink()

            # 删除记录文件
            audio_file.unlink()
            return True
        except Exception as e:
            print(f"Error deleting audio {audio_id}: {e}")
            return False

    @staticmethod
    def set_primary_audio(project_id: str, audio_id: str, storyboard_id: Optional[str] = None, character_id: Optional[str] = None) -> bool:
        """设置主音频（支持按 storyboard_id 或 character_id 范围）"""
        if character_id:
            audios = AudioService.list_audios(project_id, character_id=character_id)
        elif storyboard_id:
            audios = AudioService.list_audios(project_id, storyboard_id=storyboard_id)
        else:
            return False

        # 取消同范围内所有音频的主音频状态
        for audio in audios:
            if audio.get("is_primary"):
                audio["is_primary"] = False
                AudioService.save_generation_record(project_id, audio)

        # 设置目标音频为主音频
        target_audio = AudioService.get_audio(project_id, audio_id)
        if not target_audio:
            return False

        target_audio["is_primary"] = True
        AudioService.save_generation_record(project_id, target_audio)

        # 若是角色音色，回写角色的 voice_audio_id
        if character_id:
            from app.services.asset_service import AssetService
            char = AssetService.load_asset(project_id, "character", character_id)
            if char:
                char["voice_audio_id"] = audio_id
                AssetService.save_asset(project_id, "character", char)

        return True
