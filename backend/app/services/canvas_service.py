"""画布服务 - 处理画布CRUD、兼容升级与工作流运行记录"""
import json
import logging
from pathlib import Path
from typing import List, Dict, Optional, Any
from datetime import datetime

from app.core.config import settings
from app.models.project import Canvas

logger = logging.getLogger(__name__)


class CanvasService:
    """画布服务类"""

    @staticmethod
    def get_canvas_dir(project_id: str) -> Path:
        """获取画布目录"""
        return settings.PROJECTS_DIR / project_id / "canvas"

    @staticmethod
    def get_canvas_path(project_id: str, canvas_id: str) -> Path:
        """获取画布文件路径"""
        return CanvasService.get_canvas_dir(project_id) / f"{canvas_id}.json"

    @staticmethod
    def get_runs_dir(project_id: str) -> Path:
        """获取工作流运行目录"""
        return settings.PROJECTS_DIR / project_id / "canvas_runs"

    @staticmethod
    def _normalize_canvas_data(canvas_data: Dict[str, Any]) -> Dict[str, Any]:
        """兼容旧画布数据结构"""
        normalized = dict(canvas_data or {})
        normalized.setdefault("zoom", 1.0)
        normalized.setdefault("pan_x", 0.0)
        normalized.setdefault("pan_y", 0.0)
        normalized.setdefault("elements", [])

        # 旧画布无 schema_version，按 v1 处理；新建默认 v2
        if "schema_version" not in normalized:
            normalized["schema_version"] = 1
        normalized.setdefault("nodes", [])
        normalized.setdefault("edges", [])
        normalized.setdefault("variables", {})
        return normalized

    @staticmethod
    def _run_file_path(project_id: str, canvas_id: str, run_id: str) -> Path:
        return CanvasService.get_runs_dir(project_id) / f"{canvas_id}__{run_id}.json"

    @staticmethod
    def _run_events_path(project_id: str, canvas_id: str, run_id: str) -> Path:
        return CanvasService.get_runs_dir(project_id) / f"{canvas_id}__{run_id}.events.jsonl"

    @staticmethod
    def list_canvases(project_id: str) -> List[Dict]:
        """获取项目的所有画布列表"""
        canvas_dir = CanvasService.get_canvas_dir(project_id)

        if not canvas_dir.exists():
            canvas_dir.mkdir(parents=True, exist_ok=True)
            return []

        canvases = []
        for canvas_file in canvas_dir.glob("*.json"):
            try:
                with open(canvas_file, "r", encoding="utf-8") as f:
                    canvas_data = json.load(f)
                    canvases.append(CanvasService._normalize_canvas_data(canvas_data))
            except Exception as e:
                logger.error(f"Failed to load canvas {canvas_file}: {e}")
                continue

        canvases.sort(key=lambda x: x.get("created_at", ""))
        return canvases

    @staticmethod
    def create_canvas(project_id: str, name: str = "默认画布", description: str = "") -> Dict:
        """创建新画布"""
        canvas = Canvas(
            project_id=project_id,
            name=name,
            description=description,
        )

        canvas_path = CanvasService.get_canvas_path(project_id, canvas.canvas_id)
        canvas_path.parent.mkdir(parents=True, exist_ok=True)

        payload = CanvasService._normalize_canvas_data(canvas.model_dump())
        with open(canvas_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

        logger.info(f"Created canvas {canvas.canvas_id} for project {project_id}")
        return payload

    @staticmethod
    def get_canvas(project_id: str, canvas_id: str) -> Optional[Dict]:
        """获取画布详情"""
        canvas_path = CanvasService.get_canvas_path(project_id, canvas_id)

        if not canvas_path.exists():
            return None

        with open(canvas_path, "r", encoding="utf-8") as f:
            canvas_data = json.load(f)
            return CanvasService._normalize_canvas_data(canvas_data)

    @staticmethod
    def update_canvas(project_id: str, canvas_id: str, update_data: Dict) -> Optional[Dict]:
        """更新画布信息"""
        canvas_path = CanvasService.get_canvas_path(project_id, canvas_id)

        if not canvas_path.exists():
            return None

        with open(canvas_path, "r", encoding="utf-8") as f:
            canvas_data = CanvasService._normalize_canvas_data(json.load(f))

        # 允许更新字段（MVP）
        updatable_fields = {
            "name", "description", "zoom", "pan_x", "pan_y", "elements",
            "schema_version", "nodes", "edges", "variables",
        }
        for field in updatable_fields:
            if field in update_data:
                canvas_data[field] = update_data[field]

        canvas_data["updated_at"] = datetime.now().isoformat()

        with open(canvas_path, "w", encoding="utf-8") as f:
            json.dump(canvas_data, f, ensure_ascii=False, indent=2)

        logger.info(f"Updated canvas {canvas_id} for project {project_id}")
        return canvas_data

    @staticmethod
    def delete_canvas(project_id: str, canvas_id: str) -> bool:
        """删除画布"""
        canvas_path = CanvasService.get_canvas_path(project_id, canvas_id)

        if not canvas_path.exists():
            return False

        canvas_path.unlink()
        logger.info(f"Deleted canvas {canvas_id} from project {project_id}")
        return True

    @staticmethod
    def create_run(project_id: str, canvas_id: str, run_data: Dict[str, Any]) -> Dict[str, Any]:
        """创建运行记录"""
        run_id = run_data.get("run_id")
        if not run_id:
            raise ValueError("run_id is required")

        runs_dir = CanvasService.get_runs_dir(project_id)
        runs_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now().isoformat()
        payload = {
            "run_id": run_id,
            "canvas_id": canvas_id,
            "project_id": project_id,
            "status": "created",
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "finished_at": None,
            "error": None,
            "node_states": {},
            "outputs": {},
            **run_data,
        }

        run_path = CanvasService._run_file_path(project_id, canvas_id, run_id)
        with open(run_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return payload

    @staticmethod
    def get_run(project_id: str, canvas_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        run_path = CanvasService._run_file_path(project_id, canvas_id, run_id)
        if not run_path.exists():
            return None
        with open(run_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def list_runs(project_id: str, canvas_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        runs_dir = CanvasService.get_runs_dir(project_id)
        if not runs_dir.exists():
            return []

        runs: List[Dict[str, Any]] = []
        prefix = f"{canvas_id}__"
        for run_file in runs_dir.glob(f"{prefix}*.json"):
            if run_file.name.endswith(".events.jsonl"):
                continue
            try:
                with open(run_file, "r", encoding="utf-8") as f:
                    runs.append(json.load(f))
            except Exception as e:
                logger.warning(f"Failed to read run file {run_file}: {e}")

        runs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return runs[: max(1, limit)]

    @staticmethod
    def update_run(project_id: str, canvas_id: str, run_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        run = CanvasService.get_run(project_id, canvas_id, run_id)
        if not run:
            return None

        run.update(update_data)
        run["updated_at"] = datetime.now().isoformat()

        run_path = CanvasService._run_file_path(project_id, canvas_id, run_id)
        with open(run_path, "w", encoding="utf-8") as f:
            json.dump(run, f, ensure_ascii=False, indent=2)
        return run

    @staticmethod
    def append_run_event(project_id: str, canvas_id: str, run_id: str, event: Dict[str, Any]) -> None:
        events_path = CanvasService._run_events_path(project_id, canvas_id, run_id)
        events_path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "timestamp": datetime.now().isoformat(),
            **event,
        }
        with open(events_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    @staticmethod
    def list_run_events(project_id: str, canvas_id: str, run_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        events_path = CanvasService._run_events_path(project_id, canvas_id, run_id)
        if not events_path.exists():
            return []

        events: List[Dict[str, Any]] = []
        with open(events_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        return events[-max(1, limit):]

    @staticmethod
    def cancel_run(project_id: str, canvas_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        run = CanvasService.get_run(project_id, canvas_id, run_id)
        if not run:
            return None

        terminal_statuses = {"succeeded", "failed", "canceled", "partial_failed"}
        if run.get("status") in terminal_statuses:
            return run

        return CanvasService.update_run(
            project_id,
            canvas_id,
            run_id,
            {"cancel_requested": True, "status": "canceling"},
        )
