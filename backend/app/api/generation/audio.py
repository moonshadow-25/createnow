"""
Generation API - 音频生成相关端点
"""

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Body, UploadFile, File
from pydantic import BaseModel

from app.services import AudioService, get_tts_service
from app.services.audio_download_service import AudioDownloadService
from app.core.config import settings
from app.core.context import get_current_data_root

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class AudioGenerateRequest(BaseModel):
    """音频生成请求"""
    text: str  # 要转换的文本
    storyboard_id: Optional[str] = None  # 关联的分镜
    episode_id: Optional[str] = None  # 关联的剧集
    voice: Optional[str] = None  # 音色（OpenAI/阿里百炼）
    speaker_id: Optional[str] = None  # Speaker ID（本地API）
    format: str = "mp3"  # 音频格式


@router.post("/audio")
async def generate_audio(project_id: str, request: AudioGenerateRequest):
    """生成音频"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    try:
        # 获取TTS服务
        tts_service = get_tts_service(ai_config, project_id)

        # 调用TTS API生成音频
        result = await tts_service.generate(
            text=request.text,
            voice=request.voice,
            speaker_id=request.speaker_id,
            format=request.format
        )

        await tts_service.close()

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        # 生成音频ID
        audio_id = str(uuid.uuid4())

        # 保存生成记录
        record = {
            "audio_id": audio_id,
            "project_id": project_id,
            "storyboard_id": request.storyboard_id,
            "episode_id": request.episode_id,
            "text": request.text,
            "voice": request.voice,
            "speaker_id": request.speaker_id,
            "model": ai_config.get("tts", {}).get("model", "tts-1"),
            "format": request.format,
            "created_at": datetime.now().isoformat(),
            "is_primary": False
        }

        # 处理返回的音频数据
        if "audio_data" in result:
            # 直接保存音频二进制数据
            local_path = await AudioDownloadService.save_audio_data(
                project_id=project_id,
                audio_id=audio_id,
                audio_data=result["audio_data"],
                format=request.format
            )
            if local_path:
                record["local_path"] = local_path
                logger.info(f"[AudioGen] 音频已保存到本地: {local_path}")
            else:
                logger.warning(f"[AudioGen] 保存音频数据失败")

        elif "audio_url" in result:
            # API返回URL，异步下载
            record["audio_path"] = result["audio_url"]
            logger.info(f"[AudioGen] 音频URL: {result['audio_url']}")

            # 异步下载到本地
            import asyncio
            asyncio.create_task(
                AudioDownloadService.download_and_save_audio(
                    project_id=project_id,
                    audio_id=audio_id,
                    url=result["audio_url"],
                    format=request.format
                )
            )

        # 保存记录
        saved = AudioService.save_generation_record(project_id, record)

        # 如果是第一个音频，自动设置为主音频
        if request.storyboard_id:
            audios = AudioService.list_audios(project_id, storyboard_id=request.storyboard_id)
            if len(audios) == 1:
                AudioService.set_primary_audio(project_id, audio_id, storyboard_id=request.storyboard_id)
                saved["is_primary"] = True

        return saved

    except HTTPException:
        raise
    except Exception as e:
        if 'tts_service' in locals():
            await tts_service.close()
        logger.error(f"[AudioGen] 生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audios")
async def list_audios(
    project_id: str,
    storyboard_id: Optional[str] = None,
    episode_id: Optional[str] = None,
    character_id: Optional[str] = None
):
    """列出音频记录"""
    audios = AudioService.list_audios(project_id, storyboard_id, episode_id, character_id)
    return audios


@router.get("/audios/{audio_id}")
async def get_audio(project_id: str, audio_id: str):
    """获取单个音频记录"""
    audio = AudioService.get_audio(project_id, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")
    return audio


@router.delete("/audios/{audio_id}")
async def delete_audio(project_id: str, audio_id: str):
    """删除音频"""
    success = AudioService.delete_audio(project_id, audio_id)
    if not success:
        raise HTTPException(status_code=404, detail="Audio not found")
    return {"success": True}


@router.get("/audios/{audio_id}/file")
async def get_audio_file(project_id: str, audio_id: str):
    """获取音频文件（本地存储）"""
    from fastapi.responses import FileResponse
    audio = AudioService.get_audio(project_id, audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio not found")

    local_path = audio.get("local_path")
    if not local_path:
        raise HTTPException(status_code=404, detail="No local file for this audio")

    file_path = _get_projects_dir() / project_id / "audios" / "files" / local_path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    fmt = audio.get("format", "mp3")
    media_type_map = {"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "ogg": "audio/ogg"}
    return FileResponse(str(file_path), media_type=media_type_map.get(fmt, "audio/mpeg"))


class SetPrimaryAudioRequest(BaseModel):
    storyboard_id: Optional[str] = None
    character_id: Optional[str] = None


@router.post("/audios/{audio_id}/set-primary")
async def set_primary_audio(
    project_id: str,
    audio_id: str,
    request: SetPrimaryAudioRequest
):
    """设置主音频（支持 storyboard_id 或 character_id）"""
    if not request.storyboard_id and not request.character_id:
        raise HTTPException(status_code=400, detail="storyboard_id or character_id required")

    success = AudioService.set_primary_audio(
        project_id, audio_id,
        storyboard_id=request.storyboard_id,
        character_id=request.character_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Audio not found")

    audio = AudioService.get_audio(project_id, audio_id)
    return {"success": True, "audio": audio}


class CharacterVoiceRequest(BaseModel):
    """角色音色生成请求"""
    voice_prompt: str                    # 音色描述，存入角色
    sample_text: str                     # 朗读文本
    voice: Optional[str] = None          # TTS 音色名（可选）
    speaker_id: Optional[str] = None     # 本地 API speaker_id（可选）
    format: str = "mp3"


async def _save_character_voice_audio(
    project_id: str,
    character_id: str,
    audio_id: str,
    result: dict,
    record: dict,
    fmt: str
):
    """保存角色音色音频并自动设主（内部复用）"""
    if "audio_data" in result:
        local_path = await AudioDownloadService.save_audio_data(
            project_id=project_id,
            audio_id=audio_id,
            audio_data=result["audio_data"],
            format=fmt
        )
        if local_path:
            record["local_path"] = local_path
    elif "audio_url" in result:
        record["audio_path"] = result["audio_url"]
        import asyncio
        asyncio.create_task(
            AudioDownloadService.download_and_save_audio(
                project_id=project_id,
                audio_id=audio_id,
                url=result["audio_url"],
                format=fmt
            )
        )

    saved = AudioService.save_generation_record(project_id, record)

    # 若是该角色第一条音色，自动设为主音色
    existing = AudioService.list_audios(project_id, character_id=character_id)
    if len(existing) == 1:
        AudioService.set_primary_audio(project_id, audio_id, character_id=character_id)
        saved["is_primary"] = True

    return saved


@router.post("/characters/{character_id}/voice")
async def generate_character_voice(project_id: str, character_id: str, request: CharacterVoiceRequest):
    """为角色生成音色样本"""
    from app.services import ProjectService
    from app.services.asset_service import AssetService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    char = AssetService.load_asset(project_id, "character", character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    ai_config = project.get("ai_config", {})

    try:
        tts_service = get_tts_service(ai_config, project_id)
        result = await tts_service.generate(
            text=request.sample_text,
            voice=request.voice,
            speaker_id=request.speaker_id,
            format=request.format
        )
        await tts_service.close()

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        audio_id = str(uuid.uuid4())
        record = {
            "audio_id": audio_id,
            "project_id": project_id,
            "character_id": character_id,
            "text": request.sample_text,
            "voice": request.voice,
            "speaker_id": request.speaker_id,
            "model": ai_config.get("tts", {}).get("model", "tts-1"),
            "format": request.format,
            "created_at": datetime.now().isoformat(),
            "is_primary": False
        }

        saved = await _save_character_voice_audio(project_id, character_id, audio_id, result, record, request.format)

        # 更新角色的 voice_prompt / voice_id
        char["voice_prompt"] = request.voice_prompt
        if request.voice:
            char["voice_id"] = request.voice
        elif request.speaker_id:
            char["voice_id"] = request.speaker_id
        AssetService.save_asset(project_id, "character", char)

        return {"audio": saved, "character": char}

    except HTTPException:
        raise
    except Exception as e:
        if 'tts_service' in locals():
            await tts_service.close()
        logger.error(f"[CharacterVoice] 生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/characters/{character_id}/voice/upload")
async def upload_character_voice(
    project_id: str,
    character_id: str,
    file: UploadFile = File(...)
):
    """上传角色音色文件"""
    from app.services import ProjectService
    from app.services.asset_service import AssetService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    char = AssetService.load_asset(project_id, "character", character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # 校验文件类型
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("mp3", "wav", "m4a", "ogg"):
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    try:
        audio_data = await file.read()
        audio_id = str(uuid.uuid4())

        local_path = await AudioDownloadService.save_audio_data(
            project_id=project_id,
            audio_id=audio_id,
            audio_data=audio_data,
            format=ext
        )

        record = {
            "audio_id": audio_id,
            "project_id": project_id,
            "character_id": character_id,
            "text": "",
            "model": "manual_upload",
            "format": ext,
            "local_path": local_path,
            "created_at": datetime.now().isoformat(),
            "is_primary": False
        }

        saved = AudioService.save_generation_record(project_id, record)

        # 若是第一条，自动设为主音色
        existing = AudioService.list_audios(project_id, character_id=character_id)
        if len(existing) == 1:
            AudioService.set_primary_audio(project_id, audio_id, character_id=character_id)
            saved["is_primary"] = True

        return saved

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CharacterVoice] 上传失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
