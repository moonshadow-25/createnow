import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from app.core.config import settings
from app.core.context import get_current_data_root

SNAPSHOT_VERSION = 2


def _get_projects_dir() -> Path:
    data_root = get_current_data_root()
    if data_root:
        return Path(data_root) / "projects"
    return settings.PROJECTS_DIR


def _snapshot_path(project_id: str) -> Path:
    return _get_projects_dir() / project_id / "cache" / "stats_snapshot.json"


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


def write_snapshot(project_id: str, stats: Dict, user_costs: Dict, unknown_costs: Dict) -> None:
    path = _snapshot_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    unknown_total = float((unknown_costs or {}).get("total_cost") or 0)
    data = {
        "version": SNAPSHOT_VERSION,
        "project_id": project_id,
        "updated_at": datetime.now().isoformat(),
        "stats": stats,
        "user_costs": user_costs,
        "unknown_cost": round(unknown_total, 2),
        "unknown_costs": {
            "image_cost": round(float((unknown_costs or {}).get("image_cost") or 0), 2),
            "video_cost": round(float((unknown_costs or {}).get("video_cost") or 0), 2),
            "total_cost": round(unknown_total, 2),
        },
    }
    tmp_path = path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def delete_snapshot(project_id: str) -> bool:
    path = _snapshot_path(project_id)
    if path.exists():
        try:
            path.unlink()
            return True
        except Exception:
            return False
    return False
