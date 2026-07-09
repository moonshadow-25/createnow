"""
项目资产导出服务

将项目中的本地图片/视频资产复制到当前 data 根目录的 output/assets 下，
不打包 zip，供客户在机器本地直接取用。
"""

import json
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

from app.core.config import settings
from app.core.context import get_current_data_root
from app.services.asset_service import AssetService, ImageService, ProjectService, VideoService

logger = logging.getLogger(__name__)

CANVAS_SCOPE = "canvas_generate"
SQUARE_SCOPE = "square_generate"
CANVAS_GENERATE_ASSET_ID = "canvas-generate"
SQUARE_GENERATE_ASSET_ID = "square-generate"
EXPORT_SCHEMA_VERSION = "1.0"


class ProjectAssetExportService:
    """项目资产导出服务"""

    @staticmethod
    def export_project_assets(project_id: str) -> Dict[str, Any]:
        project = ProjectService.get_project(project_id)
        if not project:
            raise ValueError("项目不存在")

        data_root = ProjectAssetExportService._get_data_root()
        project_dir = data_root / "projects" / project_id
        if not project_dir.exists():
            raise ValueError("项目目录不存在")

        export_dir = ProjectAssetExportService._build_export_dir(data_root, project)
        export_dir.mkdir(parents=True, exist_ok=True)

        manifest: Dict[str, Any] = {
            "schema_version": EXPORT_SCHEMA_VERSION,
            "exported_at": datetime.now().isoformat(),
            "project": {
                "id": project_id,
                "name": project.get("name") or project_id,
            },
            "output_dir": str(export_dir),
            "summary": {
                "episode_videos": 0,
                "asset_images": 0,
                "canvas_videos": 0,
                "canvas_images": 0,
                "square_videos": 0,
                "square_images": 0,
                "skipped": 0,
            },
            "files": [],
            "skipped": [],
        }

        episodes = AssetService.list_assets(project_id, "episode", include_children=True)
        storyboards = AssetService.list_assets(project_id, "storyboard", include_children=True)
        images = list(ImageService.list_images(project_id))
        videos = VideoService.list_videos(project_id)

        copied_sources: set[Path] = set()

        ProjectAssetExportService._export_episode_videos(
            project_id=project_id,
            project_dir=project_dir,
            export_dir=export_dir,
            episodes=episodes,
            storyboards=storyboards,
            videos=videos,
            manifest=manifest,
            copied_sources=copied_sources,
        )
        ProjectAssetExportService._export_asset_images(
            project_id=project_id,
            project_dir=project_dir,
            export_dir=export_dir,
            episodes=episodes,
            storyboards=storyboards,
            images=images,
            manifest=manifest,
            copied_sources=copied_sources,
        )
        ProjectAssetExportService._export_scoped_media(
            project_dir=project_dir,
            export_dir=export_dir,
            images=images,
            videos=videos,
            manifest=manifest,
            copied_sources=copied_sources,
            scope=CANVAS_SCOPE,
            legacy_asset_id=CANVAS_GENERATE_ASSET_ID,
            folder="03-画布",
            filename_prefix="canvas",
            image_summary_key="canvas_images",
            video_summary_key="canvas_videos",
        )
        ProjectAssetExportService._export_scoped_media(
            project_dir=project_dir,
            export_dir=export_dir,
            images=images,
            videos=videos,
            manifest=manifest,
            copied_sources=copied_sources,
            scope=SQUARE_SCOPE,
            legacy_asset_id=SQUARE_GENERATE_ASSET_ID,
            folder="04-广场",
            filename_prefix="square",
            image_summary_key="square_images",
            video_summary_key="square_videos",
            # 广场视频历史未写 generation_scope：无 scope、无分镜、无剧集归属的视频默认按广场导出
            treat_untagged_video_as_scope=True,
        )

        manifest["summary"]["skipped"] = len(manifest["skipped"])
        manifest_path = export_dir / "export_manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

        return {
            "success": True,
            "output_dir": str(export_dir),
            "summary": manifest["summary"],
            "warnings": manifest["skipped"],
            "message": f"资产已导出到 {export_dir}",
        }

    @staticmethod
    def _get_data_root() -> Path:
        data_root = get_current_data_root()
        return Path(data_root) if data_root else settings.DATA_DIR

    @staticmethod
    def _build_export_dir(data_root: Path, project: Dict[str, Any]) -> Path:
        project_id = project.get("project_id") or project.get("id") or "project"
        project_name = ProjectAssetExportService._sanitize_name(project.get("name") or project_id, max_len=50)
        project_folder = f"{project_name}-{str(project_id)[:8]}"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_dir = data_root / "output" / "assets" / project_folder
        export_dir = base_dir / timestamp
        if not export_dir.exists():
            return export_dir
        index = 1
        while True:
            candidate = base_dir / f"{timestamp}_{index}"
            if not candidate.exists():
                return candidate
            index += 1

    @staticmethod
    def _sanitize_name(value: Any, max_len: int = 80) -> str:
        text = str(value or "").strip()
        text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
        text = re.sub(r"\s+", " ", text).strip(" .")
        text = re.sub(r"_+", "_", text)
        if not text:
            text = "未命名"
        return text[:max_len].rstrip(" ._") or "未命名"

    @staticmethod
    def _episode_label(episode: Optional[Dict[str, Any]], fallback_index: int) -> str:
        if not episode:
            return "未分集"
        number = episode.get("episode_number") or fallback_index
        try:
            prefix = f"第{int(number):02d}集"
        except Exception:
            prefix = f"第{number}集"
        name = ProjectAssetExportService._sanitize_name(episode.get("name") or "", max_len=50)
        return f"{prefix}-{name}" if name != "未命名" else prefix

    @staticmethod
    def _storyboard_label(storyboard: Dict[str, Any], fallback_index: int) -> str:
        sequence = ProjectAssetExportService._storyboard_sequence(storyboard, fallback_index)
        return f"分镜{sequence:03d}"

    @staticmethod
    def _storyboard_sequence(storyboard: Dict[str, Any], fallback_index: int) -> int:
        try:
            return int(storyboard.get("sequence") or fallback_index)
        except Exception:
            return fallback_index

    @staticmethod
    def _record_id(record: Dict[str, Any], *keys: str) -> str:
        for key in keys:
            if record.get(key):
                return str(record[key])
        return ""

    @staticmethod
    def _sort_created(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(records, key=lambda item: str(item.get("created_at") or item.get("updated_at") or ""))

    @staticmethod
    def _resolve_image_path(project_dir: Path, image: Dict[str, Any]) -> Optional[Path]:
        local_path = image.get("local_path")
        if local_path:
            path = project_dir / "images" / "files" / str(local_path)
            if path.exists():
                return path

        image_path = image.get("image_path") or image.get("url")
        if not image_path:
            return None
        return ProjectAssetExportService._resolve_project_media_path(
            project_dir=project_dir,
            value=str(image_path),
            media_root="images",
            files_dir="files",
        )

    @staticmethod
    def _resolve_video_path(project_dir: Path, video: Dict[str, Any]) -> Optional[Path]:
        local_path = video.get("local_path")
        if local_path:
            path = project_dir / "videos" / "files" / str(local_path)
            if path.exists():
                return path

        video_path = video.get("video_path") or video.get("url")
        if not video_path:
            return None
        return ProjectAssetExportService._resolve_project_media_path(
            project_dir=project_dir,
            value=str(video_path),
            media_root="videos",
            files_dir="files",
        )

    @staticmethod
    def _resolve_project_media_path(project_dir: Path, value: str, media_root: str, files_dir: str) -> Optional[Path]:
        value = value.strip()
        if not value or value.startswith(("http://", "https://")):
            return None

        parsed_path = unquote(urlparse(value).path if "://" in value else value)
        marker = f"/{media_root}/{files_dir}/"
        normalized = parsed_path.replace("\\", "/")
        if marker in normalized:
            relative = normalized.split(marker, 1)[1]
            path = project_dir / media_root / files_dir / relative
            return path if path.exists() else None

        api_marker = f"/api/projects/"
        if normalized.startswith(api_marker) and marker in normalized:
            relative = normalized.split(marker, 1)[1]
            path = project_dir / media_root / files_dir / relative
            return path if path.exists() else None

        candidate = Path(value)
        if candidate.exists():
            return candidate

        relative_candidate = project_dir / media_root / files_dir / value
        if relative_candidate.exists():
            return relative_candidate
        return None

    @staticmethod
    def _copy_file(
        source: Optional[Path],
        dest: Path,
        manifest: Dict[str, Any],
        copied_sources: set[Path],
        entry: Dict[str, Any],
        summary_key: str,
    ) -> bool:
        if not source:
            ProjectAssetExportService._skip(manifest, "file_not_found", entry)
            return False
        try:
            resolved = source.resolve()
        except Exception:
            resolved = source
        if not source.exists() or not source.is_file():
            ProjectAssetExportService._skip(manifest, "file_not_found", entry, str(source))
            return False

        dest = ProjectAssetExportService._unique_path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
        copied_sources.add(resolved)

        manifest["summary"][summary_key] += 1
        manifest["files"].append({
            **entry,
            "source_path": str(source),
            "export_path": str(dest),
        })
        return True

    @staticmethod
    def _unique_path(path: Path) -> Path:
        if not path.exists():
            return path
        stem = path.stem
        suffix = path.suffix
        index = 2
        while True:
            candidate = path.with_name(f"{stem}-{index}{suffix}")
            if not candidate.exists():
                return candidate
            index += 1

    @staticmethod
    def _skip(manifest: Dict[str, Any], reason: str, entry: Dict[str, Any], source_path: str = "") -> None:
        manifest["skipped"].append({
            "reason": reason,
            "source_path": source_path,
            **entry,
        })

    @staticmethod
    def _export_episode_videos(
        project_id: str,
        project_dir: Path,
        export_dir: Path,
        episodes: List[Dict[str, Any]],
        storyboards: List[Dict[str, Any]],
        videos: List[Dict[str, Any]],
        manifest: Dict[str, Any],
        copied_sources: set[Path],
    ) -> None:
        episode_by_id = {ep.get("asset_id"): ep for ep in episodes if ep.get("asset_id")}
        episode_index = {ep.get("asset_id"): idx for idx, ep in enumerate(episodes, start=1) if ep.get("asset_id")}
        storyboard_by_id = {sb.get("asset_id"): sb for sb in storyboards if sb.get("asset_id")}

        videos_by_storyboard: Dict[str, List[Dict[str, Any]]] = {}
        for video in videos:
            if video.get("generation_scope") in {CANVAS_SCOPE, SQUARE_SCOPE}:
                continue
            storyboard_id = video.get("storyboard_id")
            if storyboard_id:
                videos_by_storyboard.setdefault(str(storyboard_id), []).append(video)

        for storyboard_id, storyboard_videos in videos_by_storyboard.items():
            storyboard = storyboard_by_id.get(storyboard_id)
            if not storyboard:
                continue
            episode_id = storyboard.get("episode_id")
            episode = episode_by_id.get(episode_id)
            episode_label = ProjectAssetExportService._episode_label(episode, episode_index.get(episode_id, 0))
            sequence = ProjectAssetExportService._storyboard_sequence(storyboard, 0)
            completed = [v for v in ProjectAssetExportService._sort_created(storyboard_videos) if v.get("status") == "completed"]
            if not completed:
                for video in storyboard_videos:
                    ProjectAssetExportService._skip(manifest, "video_not_completed", {
                        "type": "episode_video",
                        "video_id": ProjectAssetExportService._record_id(video, "video_id", "task_id"),
                        "storyboard_id": storyboard_id,
                        "status": video.get("status"),
                    })
                continue

            explicit_primary = next((v for v in completed if v.get("is_primary") or v.get("primary")), None)
            primary = explicit_primary or completed[0]
            non_primary = [v for v in completed if v is not primary]

            source = ProjectAssetExportService._resolve_video_path(project_dir, primary)
            ext = source.suffix if source else ".mp4"
            ProjectAssetExportService._copy_file(
                source=source,
                dest=export_dir / "01-分集视频" / episode_label / f"{sequence:03d}-主视频{ext}",
                manifest=manifest,
                copied_sources=copied_sources,
                summary_key="episode_videos",
                entry={
                    "type": "episode_video",
                    "video_id": ProjectAssetExportService._record_id(primary, "video_id", "task_id"),
                    "episode_id": episode_id,
                    "storyboard_id": storyboard_id,
                    "is_primary": True,
                },
            )

            for index, video in enumerate(non_primary, start=1):
                source = ProjectAssetExportService._resolve_video_path(project_dir, video)
                ext = source.suffix if source else ".mp4"
                ProjectAssetExportService._copy_file(
                    source=source,
                    dest=export_dir / "01-分集视频" / episode_label / f"{sequence:03d}-{index:03d}{ext}",
                    manifest=manifest,
                    copied_sources=copied_sources,
                    summary_key="episode_videos",
                    entry={
                        "type": "episode_video",
                        "video_id": ProjectAssetExportService._record_id(video, "video_id", "task_id"),
                        "episode_id": episode_id,
                        "storyboard_id": storyboard_id,
                        "is_primary": False,
                    },
                )

    @staticmethod
    def _export_asset_images(
        project_id: str,
        project_dir: Path,
        export_dir: Path,
        episodes: List[Dict[str, Any]],
        storyboards: List[Dict[str, Any]],
        images: List[Dict[str, Any]],
        manifest: Dict[str, Any],
        copied_sources: set[Path],
    ) -> None:
        images_by_asset: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        for image in images:
            asset_type = image.get("asset_type")
            asset_id = image.get("asset_id")
            if asset_type and asset_id:
                images_by_asset.setdefault((str(asset_type), str(asset_id)), []).append(image)

        episode_by_id = {ep.get("asset_id"): ep for ep in episodes if ep.get("asset_id")}
        episode_index = {ep.get("asset_id"): idx for idx, ep in enumerate(episodes, start=1) if ep.get("asset_id")}

        for asset_type in ["character", "scene", "prop", "storyboard"]:
            assets = storyboards if asset_type == "storyboard" else AssetService.list_assets(project_id, asset_type, include_children=True)
            for asset_index, asset in enumerate(assets, start=1):
                asset_id = asset.get("asset_id")
                if not asset_id:
                    continue
                asset_images = ProjectAssetExportService._sort_created(images_by_asset.get((asset_type, str(asset_id)), []))
                if not asset_images:
                    continue

                local_images = []
                for image in asset_images:
                    source = ProjectAssetExportService._resolve_image_path(project_dir, image)
                    if source:
                        local_images.append((image, source))
                    else:
                        ProjectAssetExportService._skip(manifest, "image_file_not_found_or_remote", {
                            "type": "asset_image",
                            "asset_type": asset_type,
                            "asset_id": asset_id,
                            "image_id": image.get("image_id"),
                        })
                if not local_images:
                    continue

                asset_name = ProjectAssetExportService._asset_display_name(asset_type, asset, asset_index)
                if asset_type == "storyboard":
                    episode = episode_by_id.get(asset.get("episode_id"))
                    folder = export_dir / "02-资产图片" / asset_type / ProjectAssetExportService._episode_label(
                        episode,
                        episode_index.get(asset.get("episode_id"), 0),
                    ) / asset_name
                else:
                    folder = export_dir / "02-资产图片" / asset_type / asset_name

                primary_id = asset.get("primary_image_id") or asset.get("image_id")
                primary_pair = next((pair for pair in local_images if pair[0].get("image_id") == primary_id), None)
                if not primary_pair:
                    primary_pair = next((pair for pair in local_images if pair[0].get("is_primary") or pair[0].get("primary")), None)
                if not primary_pair:
                    primary_pair = local_images[0]

                image, source = primary_pair
                ProjectAssetExportService._copy_file(
                    source=source,
                    dest=folder / f"{asset_name}-主图{source.suffix}",
                    manifest=manifest,
                    copied_sources=copied_sources,
                    summary_key="asset_images",
                    entry={
                        "type": "asset_image",
                        "asset_type": asset_type,
                        "asset_id": asset_id,
                        "image_id": image.get("image_id"),
                        "is_primary": True,
                    },
                )

                serial = 1
                for image, source in local_images:
                    if image is primary_pair[0]:
                        continue
                    ProjectAssetExportService._copy_file(
                        source=source,
                        dest=folder / f"{asset_name}-{serial:03d}{source.suffix}",
                        manifest=manifest,
                        copied_sources=copied_sources,
                        summary_key="asset_images",
                        entry={
                            "type": "asset_image",
                            "asset_type": asset_type,
                            "asset_id": asset_id,
                            "image_id": image.get("image_id"),
                            "is_primary": False,
                        },
                    )
                    serial += 1

    @staticmethod
    def _asset_display_name(asset_type: str, asset: Dict[str, Any], fallback_index: int) -> str:
        if asset_type == "storyboard":
            return ProjectAssetExportService._storyboard_label(asset, fallback_index)
        return ProjectAssetExportService._sanitize_name(
            asset.get("name") or asset.get("title") or f"未命名资产-{str(asset.get('asset_id') or fallback_index)[:8]}",
            max_len=60,
        )

    @staticmethod
    def _export_scoped_media(
        project_dir: Path,
        export_dir: Path,
        images: List[Dict[str, Any]],
        videos: List[Dict[str, Any]],
        manifest: Dict[str, Any],
        copied_sources: set[Path],
        scope: str,
        legacy_asset_id: str,
        folder: str,
        filename_prefix: str,
        image_summary_key: str,
        video_summary_key: str,
        treat_untagged_video_as_scope: bool = False,
    ) -> None:
        scoped_images = [
            image for image in ProjectAssetExportService._sort_created(images)
            if image.get("generation_scope") == scope
            or (image.get("asset_type") == "generate" and image.get("asset_id") == legacy_asset_id)
        ]

        def _is_scope_video(video: Dict[str, Any]) -> bool:
            if video.get("generation_scope") == scope:
                return True
            # 广场视频历史未写 generation_scope：无 scope、无分镜、无剧集归属的视频默认归为广场
            if treat_untagged_video_as_scope and not video.get("generation_scope") \
                    and not video.get("storyboard_id") and not video.get("episode_id"):
                return True
            return False

        scoped_videos = [
            video for video in ProjectAssetExportService._sort_created(videos)
            if _is_scope_video(video)
        ]

        image_index = 1
        for image in scoped_images:
            source = ProjectAssetExportService._resolve_image_path(project_dir, image)
            if not source:
                ProjectAssetExportService._skip(manifest, "image_file_not_found_or_remote", {
                    "type": f"{filename_prefix}_image",
                    "image_id": image.get("image_id"),
                })
                continue
            ProjectAssetExportService._copy_file(
                source=source,
                dest=export_dir / folder / "images" / f"{filename_prefix}-{image_index:03d}{source.suffix}",
                manifest=manifest,
                copied_sources=copied_sources,
                summary_key=image_summary_key,
                entry={
                    "type": f"{filename_prefix}_image",
                    "image_id": image.get("image_id"),
                },
            )
            image_index += 1

        video_index = 1
        for video in scoped_videos:
            if video.get("status") != "completed":
                ProjectAssetExportService._skip(manifest, "video_not_completed", {
                    "type": f"{filename_prefix}_video",
                    "video_id": ProjectAssetExportService._record_id(video, "video_id", "task_id"),
                    "status": video.get("status"),
                })
                continue
            source = ProjectAssetExportService._resolve_video_path(project_dir, video)
            if not source:
                ProjectAssetExportService._skip(manifest, "file_not_found", {
                    "type": f"{filename_prefix}_video",
                    "video_id": ProjectAssetExportService._record_id(video, "video_id", "task_id"),
                })
                continue
            ProjectAssetExportService._copy_file(
                source=source,
                dest=export_dir / folder / "videos" / f"{filename_prefix}-{video_index:03d}{source.suffix}",
                manifest=manifest,
                copied_sources=copied_sources,
                summary_key=video_summary_key,
                entry={
                    "type": f"{filename_prefix}_video",
                    "video_id": ProjectAssetExportService._record_id(video, "video_id", "task_id"),
                },
            )
            video_index += 1
