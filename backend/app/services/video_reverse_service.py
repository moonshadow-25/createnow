import json
import mimetypes
import os
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, UploadFile

from app.core.config import settings
from app.core.context import get_current_data_root
from app.services.asset_service import AssetService
from app.services.ai_service import get_ai_service
from app.services.global_prompt_service import get_prompt_content
from app.services.prompt_service import PromptService
from app.services.storyboard_asset_service import match_assets_to_storyboards
from app.services.video_service import FFMPEG_BIN


class VideoReverseService:
    """分集视频反推剧本服务。"""

    MAX_DURATION_SECONDS = 300.0

    @staticmethod
    def _get_projects_dir() -> Path:
        data_root = get_current_data_root()
        if data_root:
            return Path(data_root) / "projects"
        return settings.PROJECTS_DIR

    @classmethod
    def _get_project_dir(cls, project_id: str) -> Path:
        return cls._get_projects_dir() / project_id

    @classmethod
    def _get_temp_upload_dir(cls, project_id: str) -> Path:
        temp_dir = cls._get_project_dir(project_id) / "videos" / "reverse_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        return temp_dir

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        base = Path(filename or "upload.mp4").name
        return re.sub(r"[^A-Za-z0-9._-]", "_", base) or "upload.mp4"

    @classmethod
    async def save_temp_video(cls, project_id: str, upload_file: UploadFile) -> Path:
        content_type = (upload_file.content_type or "").lower()
        if not content_type.startswith("video/"):
            raise HTTPException(status_code=400, detail=f"上传文件必须是 video/*，当前为: {upload_file.content_type or 'unknown'}")

        temp_dir = cls._get_temp_upload_dir(project_id)
        filename = f"{uuid.uuid4()}_{cls._sanitize_filename(upload_file.filename or 'upload.mp4')}"
        saved_path = temp_dir / filename

        try:
            with saved_path.open("wb") as f:
                while True:
                    chunk = await upload_file.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
        finally:
            await upload_file.close()

        return saved_path

    @staticmethod
    def _parse_ffmpeg_duration(stderr: str) -> Optional[float]:
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", stderr or "")
        if not match:
            return None
        hours = int(match.group(1))
        minutes = int(match.group(2))
        seconds = float(match.group(3))
        return hours * 3600 + minutes * 60 + seconds

    @classmethod
    def probe_video_duration(cls, video_path: Path) -> float:
        command = [FFMPEG_BIN, "-i", str(video_path)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        except subprocess.TimeoutExpired as e:
            raise HTTPException(status_code=500, detail="FFmpeg 校验视频时长超时，请更换文件后重试。") from e

        duration = cls._parse_ffmpeg_duration(result.stderr)
        if duration is None:
            detail = (result.stderr or result.stdout or "unknown error").strip().splitlines()[-1:]
            raise HTTPException(status_code=400, detail=f"FFmpeg 无法解析视频时长：{detail[0] if detail else 'unknown error'}")
        if duration > cls.MAX_DURATION_SECONDS:
            raise HTTPException(status_code=400, detail=f"上传视频时长 {duration:.2f} 秒，超过 300 秒限制。")
        return duration

    @staticmethod
    def _safe_format(template: str, **kwargs: Any) -> str:
        for key, value in kwargs.items():
            template = template.replace("{" + key + "}", str(value))
        return template

    @staticmethod
    def _extract_json_array(content: str) -> List[Dict[str, Any]]:
        code_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
        if code_block:
            content = code_block.group(1).strip()
        match = re.search(r"\[[\s\S]*\]", content)
        if not match:
            raise ValueError("未找到 JSON 数组")
        data = json.loads(match.group())
        if not isinstance(data, list):
            raise ValueError("返回内容不是 JSON 数组")
        return data

    @staticmethod
    def _extract_json_object(content: str) -> Dict[str, Any]:
        code_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
        if code_block:
            content = code_block.group(1).strip()
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise ValueError("未找到 JSON 对象")
        data = json.loads(match.group())
        if not isinstance(data, dict):
            raise ValueError("返回内容不是 JSON 对象")
        return data

    @staticmethod
    def _normalize_storyboard_item(index: int, item: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(item, dict):
            raise ValueError(f"第 {index} 个分镜不是对象")

        sequence = item.get("sequence")
        try:
            sequence = int(sequence)
        except Exception:
            sequence = index

        duration = item.get("duration", 5)
        try:
            duration = int(duration)
        except Exception:
            duration = 5

        video_prompt = item.get("video_prompt")
        if isinstance(video_prompt, list):
            normalized_video_prompt: Optional[Any] = [str(v).strip() for v in video_prompt if str(v).strip()]
            if not normalized_video_prompt:
                normalized_video_prompt = None
        else:
            video_prompt = str(video_prompt).strip() if video_prompt is not None else ""
            normalized_video_prompt = video_prompt or None

        resolution = item.get("resolution")
        resolution = str(resolution).strip() if resolution is not None else ""

        return {
            "sequence": sequence,
            "description": str(item.get("description") or "").strip(),
            "shot_type": str(item.get("shot_type") or "").strip() or None,
            "camera_angle": str(item.get("camera_angle") or "").strip() or None,
            "dialogue": str(item.get("dialogue") or "").strip(),
            "action": str(item.get("action") or "").strip(),
            "image_prompt": str(item.get("image_prompt") or "").strip() or None,
            "video_prompt": normalized_video_prompt,
            "duration": max(1, duration),
            "resolution": resolution or None,
            "script_scene_label": str(item.get("script_scene_label") or "").strip() or None,
        }

    @staticmethod
    def _normalize_drama_analysis(data: Dict[str, Any]) -> Dict[str, Any]:
        characters = data.get("characters", [])
        if not isinstance(characters, list):
            characters = []
        scenes = data.get("scenes", [])
        if not isinstance(scenes, list):
            scenes = []
        props = data.get("props", [])
        if not isinstance(props, list):
            props = []
        return {
            "summary": str(data.get("summary") or "").strip(),
            "plot_points": data.get("plot_points", []) if isinstance(data.get("plot_points"), list) else [],
            "timeline": data.get("timeline", []) if isinstance(data.get("timeline"), list) else [],
            "characters": characters,
            "scenes": scenes,
            "props": props,
        }

    @staticmethod
    def _guess_mime_type(video_path: Path) -> str:
        guessed, _ = mimetypes.guess_type(str(video_path))
        if guessed and guessed.startswith("video/"):
            return guessed
        return "application/octet-stream"

    @classmethod
    def _build_vlm_prompt(cls, ai_config: Dict[str, Any], key: str, **kwargs: Any) -> str:
        template = get_prompt_content(key, ai_config)
        if not template:
            raise RuntimeError(f"未找到提示词模板: {key}")
        return cls._safe_format(template, **kwargs)

    @staticmethod
    def _get_episode(project_id: str, episode_id: str) -> Dict[str, Any]:
        episode = AssetService.load_asset(project_id, "episode", episode_id)
        if not episode:
            raise HTTPException(status_code=404, detail="Episode not found")
        return episode

    @staticmethod
    def _load_existing_storyboards(project_id: str, episode_id: str) -> List[Dict[str, Any]]:
        storyboards = AssetService.list_assets(project_id, "storyboard")
        return sorted(
            [sb for sb in storyboards if sb.get("episode_id") == episode_id],
            key=lambda item: item.get("sequence", 0),
        )

    @staticmethod
    def _replace_episode_storyboards(project_id: str, episode: Dict[str, Any], storyboard_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        episode_id = episode["asset_id"]
        existing_storyboards = VideoReverseService._load_existing_storyboards(project_id, episode_id)
        existing_by_sequence = {
            int(sb.get("sequence", 0)): sb for sb in existing_storyboards if sb.get("sequence") is not None
        }

        kept_ids: List[str] = []
        used_existing_ids: set[str] = set()
        saved_storyboards: List[Dict[str, Any]] = []

        for idx, item in enumerate(sorted(storyboard_items, key=lambda x: x["sequence"]), start=1):
            sequence = idx
            current = existing_by_sequence.get(sequence)
            if current:
                sb_data = dict(current)
                used_existing_ids.add(current["asset_id"])
            else:
                sb_data = {
                    "asset_id": str(uuid.uuid4()),
                    "created_at": datetime.now().isoformat(),
                    "episode_id": episode_id,
                }

            sb_data.update({
                "episode_id": episode_id,
                "sequence": sequence,
                "description": item["description"],
                "shot_type": item["shot_type"],
                "camera_angle": item["camera_angle"],
                "dialogue": item["dialogue"],
                "action": item["action"],
                "image_prompt": item["image_prompt"],
                "video_prompt": item["video_prompt"],
                "duration": item["duration"],
                "resolution": item["resolution"],
                "script_scene_label": item["script_scene_label"],
                "updated_at": datetime.now().isoformat(),
            })

            sb_data.setdefault("character_ids", [])
            sb_data.setdefault("scene_ids", [])
            sb_data.setdefault("prop_ids", [])
            sb_data.setdefault("storyboard_mode", "regular")
            saved = AssetService.save_asset(project_id, "storyboard", sb_data)
            kept_ids.append(saved["asset_id"])
            saved_storyboards.append(saved)

        for sb in existing_storyboards:
            if sb["asset_id"] not in used_existing_ids and sb["asset_id"] not in kept_ids:
                AssetService.delete_asset(project_id, "storyboard", sb["asset_id"])

        episode["storyboard_ids"] = kept_ids
        episode["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "episode", episode)
        return saved_storyboards

    @staticmethod
    def _find_asset_by_name(existing_assets: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
        normalized = (name or "").strip().lower()
        if not normalized:
            return None
        for asset in existing_assets:
            if (asset.get("name") or "").strip().lower() == normalized:
                return asset
        return None

    @staticmethod
    def _coerce_character_payload(item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": str(item.get("name") or "").strip(),
            "description": str(item.get("description") or "").strip(),
            "gender": str(item.get("gender") or "").strip() or None,
            "age": str(item.get("age") or "").strip() or None,
            "appearance": str(item.get("appearance") or "").strip(),
            "personality": str(item.get("personality") or "").strip(),
            "background": str(item.get("background") or "").strip(),
        }

    @staticmethod
    def _coerce_scene_payload(item: Dict[str, Any]) -> Dict[str, Any]:
        name = str(item.get("name") or item.get("location") or "").strip()
        return {
            "name": name,
            "description": str(item.get("description") or "").strip(),
            "location": str(item.get("location") or name).strip(),
            "time_of_day": str(item.get("time_of_day") or "").strip() or None,
            "weather": str(item.get("weather") or "").strip() or None,
            "mood": str(item.get("mood") or "").strip(),
        }

    @staticmethod
    def _coerce_prop_payload(item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": str(item.get("name") or "").strip(),
            "description": str(item.get("description") or "").strip(),
            "category": str(item.get("category") or "").strip() or None,
            "material": str(item.get("material") or "").strip() or None,
            "era": str(item.get("era") or "").strip() or None,
        }

    @classmethod
    def _create_missing_assets(cls, project_id: str, analysis: Dict[str, Any], extract_characters: bool) -> Dict[str, List[Dict[str, Any]]]:
        created = {"characters": [], "scenes": [], "props": []}
        now = datetime.now().isoformat()

        if extract_characters:
            existing_characters = AssetService.list_assets(project_id, "character", include_children=True)
            for raw in analysis.get("characters", []):
                item = cls._coerce_character_payload(raw if isinstance(raw, dict) else {})
                if not item["name"] or cls._find_asset_by_name(existing_characters, item["name"]):
                    continue
                payload = {
                    "asset_id": str(uuid.uuid4()),
                    **item,
                    "created_at": now,
                    "updated_at": now,
                }
                saved = AssetService.save_asset(project_id, "character", payload)
                existing_characters.append(saved)
                created["characters"].append(saved)

        existing_scenes = AssetService.list_assets(project_id, "scene", include_children=True)
        for raw in analysis.get("scenes", []):
            item = cls._coerce_scene_payload(raw if isinstance(raw, dict) else {})
            if not item["name"] or cls._find_asset_by_name(existing_scenes, item["name"]):
                continue
            payload = {
                "asset_id": str(uuid.uuid4()),
                **item,
                "created_at": now,
                "updated_at": now,
            }
            saved = AssetService.save_asset(project_id, "scene", payload)
            existing_scenes.append(saved)
            created["scenes"].append(saved)

        existing_props = AssetService.list_assets(project_id, "prop", include_children=True)
        for raw in analysis.get("props", []):
            item = cls._coerce_prop_payload(raw if isinstance(raw, dict) else {})
            if not item["name"] or cls._find_asset_by_name(existing_props, item["name"]):
                continue
            payload = {
                "asset_id": str(uuid.uuid4()),
                **item,
                "created_at": now,
                "updated_at": now,
            }
            saved = AssetService.save_asset(project_id, "prop", payload)
            existing_props.append(saved)
            created["props"].append(saved)

        return created

    @classmethod
    def _normalize_reverse_segment(cls, idx: int, item: Any) -> Dict[str, Any]:
        if not isinstance(item, dict):
            item = {"prompt": str(item or "")}
        raw_duration = item.get("duration") or item.get("duration_seconds") or item.get("seconds") or 15
        try:
            duration = int(round(float(raw_duration)))
        except (TypeError, ValueError):
            duration = 15
        duration = max(1, min(duration, 15))

        shorts = item.get("shorts") if isinstance(item.get("shorts"), list) else []
        normalized_shorts = []
        for short_idx, raw_short in enumerate(shorts, start=1):
            if not isinstance(raw_short, dict):
                raw_short = {"prompt": str(raw_short or "")}
            short_duration = raw_short.get("duration") or raw_short.get("duration_seconds") or raw_short.get("seconds") or None
            try:
                short_duration = int(round(float(short_duration))) if short_duration is not None else None
            except (TypeError, ValueError):
                short_duration = None
            normalized_shorts.append({
                "index": raw_short.get("index") or raw_short.get("short_index") or short_idx,
                "duration": short_duration,
                "screenplay": str(raw_short.get("screenplay") or raw_short.get("script") or "").strip(),
                "prompt": str(raw_short.get("prompt") or raw_short.get("video_prompt") or "").strip(),
            })

        return {
            "index": item.get("index") or item.get("segment_index") or idx,
            "title": str(item.get("title") or item.get("name") or f"片段 {idx}").strip(),
            "duration": duration,
            "screenplay": str(item.get("screenplay") or item.get("script") or item.get("script_text") or "").strip(),
            "prompt": str(item.get("prompt") or item.get("segment_prompt") or item.get("video_prompt") or "").strip(),
            "shorts": normalized_shorts,
            "characters": item.get("characters") if isinstance(item.get("characters"), list) else [],
            "scenes": item.get("scenes") if isinstance(item.get("scenes"), list) else [],
            "props": item.get("props") if isinstance(item.get("props"), list) else [],
        }

    @classmethod
    async def reverse_episode_video(
        cls,
        project_id: str,
        episode_id: str,
        upload_file: UploadFile,
        ai_config: Dict[str, Any],
        overwrite_script: bool = True,
        overwrite_storyboards: bool = True,
        extract_characters: bool = True,
        match_assets: bool = True,
        preprocess_fps: int = 1,
    ) -> Dict[str, Any]:
        episode = cls._get_episode(project_id, episode_id)
        saved_video_path = await cls.save_temp_video(project_id, upload_file)
        duration_seconds = cls.probe_video_duration(saved_video_path)

        vlm = get_ai_service(ai_config, "vlm", project_id)
        try:
            prompt = cls._build_vlm_prompt(
                ai_config,
                "video_reverse_full_analysis",
                episode_number=episode.get("episode_number", ""),
                episode_title=episode.get("name", ""),
                preprocess_fps=preprocess_fps,
                max_duration_seconds=int(cls.MAX_DURATION_SECONDS),
                actual_duration_seconds=f"{duration_seconds:.2f}",
            )
            result = await vlm.analyze_video(
                video_path=str(saved_video_path),
                prompt=prompt,
                preprocess_fps=preprocess_fps,
            )
            if result.get("error"):
                raise HTTPException(status_code=502, detail=f"VLM 视频反推失败：{result['error']}")

            try:
                parsed = cls._extract_json_object(result.get("content") or "")
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"VLM 视频反推 JSON 解析失败：{e}") from e

            screenplay_text = str(parsed.get("screenplay") or parsed.get("script") or "").strip()
            if not screenplay_text:
                raise HTTPException(status_code=502, detail="VLM 返回的完整剧本为空")

            raw_segments = (
                parsed.get("segments")
                or parsed.get("segment_prompts")
                or parsed.get("story_segments")
                or []
            )
            if not isinstance(raw_segments, list):
                raw_segments = []
            segments = [cls._normalize_reverse_segment(idx, item) for idx, item in enumerate(raw_segments, start=1)]

            analysis = parsed.get("analysis") or parsed.get("drama_analysis") or {}
            if not isinstance(analysis, dict):
                analysis = {"content": str(analysis or "").strip()}

            if overwrite_script or not episode.get("script"):
                episode["script"] = screenplay_text
            now = datetime.now().isoformat()
            episode["video_reverse_screenplay"] = screenplay_text
            episode["video_reverse_segments"] = segments
            episode["video_reverse_analysis"] = analysis
            episode["video_reverse_raw"] = {
                "source_video": {
                    "filename": saved_video_path.name,
                    "path": str(saved_video_path),
                    "duration_seconds": duration_seconds,
                    "mime_type": cls._guess_mime_type(saved_video_path),
                    "preprocess_fps": preprocess_fps,
                },
                "model": getattr(vlm, "model", None),
                "usage": result.get("usage", {}),
                "raw": result.get("raw", {}),
            }
            episode["video_reverse_updated_at"] = now
            episode["updated_at"] = now
            AssetService.save_asset(project_id, "episode", episode)

            return {
                "episode_id": episode_id,
                "episode_number": episode.get("episode_number"),
                "duration_seconds": duration_seconds,
                "script_updated": bool(overwrite_script or not episode.get("script")),
                "analysis_updated": True,
                "segment_count": len(segments),
                "screenplay_preview": screenplay_text[:300],
                "analysis_summary": analysis.get("summary", ""),
                "storyboards_created": 0,
                "characters_created": 0,
                "matched_storyboards": 0,
            }
        finally:
            await vlm.close()
