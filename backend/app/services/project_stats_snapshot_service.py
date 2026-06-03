import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.core.context import get_current_data_root
from app.core.config import settings
from app.api.generation.utils import get_image_cost, get_video_cost

SNAPSHOT_VERSION = 1


def _get_projects_dir() -> Path:
    data_root = get_current_data_root()
    if data_root:
        return Path(data_root) / "projects"
    return settings.PROJECTS_DIR


def _snapshot_path(project_id: str) -> Path:
    return _get_projects_dir() / project_id / "cache" / "stats_snapshot.json"


def _read_json_files(directory: Path) -> List[Dict]:
    if not directory.exists():
        return []
    records: List[Dict] = []
    for file_path in directory.glob("*.json"):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                records.append(json.load(f))
        except Exception:
            continue
    return records


def _load_asset_records(project_id: str, asset_type: str) -> List[Dict]:
    return _read_json_files(_get_projects_dir() / project_id / f"{asset_type}s")


def _build_from_records(project_id: str, images: List[Dict], videos: List[Dict]) -> Dict:
    episodes = _load_asset_records(project_id, "episode")
    storyboards = _load_asset_records(project_id, "storyboard")
    characters = _load_asset_records(project_id, "character")
    scenes = _load_asset_records(project_id, "scene")
    props = _load_asset_records(project_id, "prop")

    total_storyboards = len(storyboards)
    storyboards_with_image = sum(1 for s in storyboards if s.get("image_id"))
    total_assets = len(characters) + len(scenes) + len(props)

    completed_storyboard_ids: set = set()
    total_video_seconds = 0.0
    storyboard_video_seconds = 0.0
    total_video_compute_units = 0.0
    storyboard_video_compute_units = 0.0
    subtitle_removal_cost = 0.0

    user_costs: Dict[str, Dict[str, float]] = {}
    unknown_cost = 0.0

    for img in images:
        cost = get_image_cost(img)
        username = (img.get("created_by") or "").strip()
        if username:
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += cost
            entry["total_cost"] += cost
        else:
            unknown_cost += cost

    for video in videos:
        cost = get_video_cost(video)
        if video.get("operation_type") == "subtitle_removal":
            subtitle_removal_cost += cost
        else:
            total_video_compute_units += cost
            if video.get("storyboard_id"):
                storyboard_video_compute_units += cost

        if video.get("status") == "completed":
            duration = float(video.get("duration") or 0)
            total_video_seconds += duration
            if video.get("storyboard_id"):
                storyboard_video_seconds += duration
                completed_storyboard_ids.add(video["storyboard_id"])

        username = (video.get("created_by") or "").strip()
        if username:
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
            entry["video_cost"] += cost
            entry["total_cost"] += cost
        else:
            unknown_cost += cost

    total_image_cost = sum(get_image_cost(img) for img in images)
    total_images = len(images)
    generated_images = sum(1 for img in images if img.get("model") not in {"manual_upload", "split"})
    other_cost = total_storyboards * 40 + total_assets * 4 + subtitle_removal_cost

    stats = {
        "episode_count": len(episodes),
        "total_storyboards": total_storyboards,
        "storyboards_with_image": storyboards_with_image,
        "storyboards_with_video": len(completed_storyboard_ids),
        "total_images": total_images,
        "generated_images": generated_images,
        "total_image_cost": round(total_image_cost, 2),
        "total_video_seconds": total_video_seconds,
        "storyboard_video_seconds": storyboard_video_seconds,
        "total_video_compute_units": total_video_compute_units,
        "storyboard_video_compute_units": storyboard_video_compute_units,
        "other_cost": other_cost,
        "total_compute_spent": round(total_image_cost + total_video_compute_units + other_cost, 2),
    }

    return {
        "version": SNAPSHOT_VERSION,
        "project_id": project_id,
        "updated_at": datetime.now().isoformat(),
        "stats": stats,
        "user_costs": user_costs,
        "unknown_cost": round(unknown_cost, 2),
    }


def has_project_runtime_cache(project_id: str) -> bool:
    from app.services.asset_service import _images_cache, _videos_cache
    return project_id in _images_cache and project_id in _videos_cache


def build_from_runtime_cache(project_id: str) -> Dict:
    from app.services.asset_service import _images_cache, _videos_cache
    return _build_from_records(project_id, list(_images_cache.get(project_id, [])), list(_videos_cache.get(project_id, [])))


def read_snapshot(project_id: str) -> Optional[Dict]:
    path = _snapshot_path(project_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("version") != SNAPSHOT_VERSION:
            return None
        return data
    except Exception:
        return None


def write_snapshot(project_id: str, data: Dict) -> None:
    path = _snapshot_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def delete_snapshot(project_id: str) -> None:
    path = _snapshot_path(project_id)
    if path.exists():
        try:
            path.unlink()
        except Exception:
            pass


def maybe_delete_snapshot(project_id: str) -> None:
    if has_project_runtime_cache(project_id):
        delete_snapshot(project_id)


def scan_project(project_id: str) -> Dict:
    project_dir = _get_projects_dir() / project_id
    images = _read_json_files(project_dir / "images")
    videos = _read_json_files(project_dir / "videos")
    return _build_from_records(project_id, images, videos)


def get_home_stats(project_id: str) -> Tuple[Dict, bool]:
    """返回项目统计快照数据；第二个返回值表示是否来自实时内存缓存。"""
    if has_project_runtime_cache(project_id):
        return build_from_runtime_cache(project_id), True

    snapshot = read_snapshot(project_id)
    if snapshot:
        return snapshot, False

    snapshot = scan_project(project_id)
    write_snapshot(project_id, snapshot)
    return snapshot, False
