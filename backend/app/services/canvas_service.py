"""画布服务 - 处理画布的CRUD和布局管理"""
import json
import logging
from pathlib import Path
from typing import List, Dict, Optional
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
                    canvases.append(canvas_data)
            except Exception as e:
                logger.error(f"Failed to load canvas {canvas_file}: {e}")
                continue

        # 按创建时间排序
        canvases.sort(key=lambda x: x.get("created_at", ""))
        return canvases

    @staticmethod
    def create_canvas(project_id: str, name: str = "默认画布", description: str = "") -> Dict:
        """创建新画布"""
        canvas = Canvas(
            project_id=project_id,
            name=name,
            description=description
        )

        canvas_path = CanvasService.get_canvas_path(project_id, canvas.canvas_id)
        canvas_path.parent.mkdir(parents=True, exist_ok=True)

        with open(canvas_path, "w", encoding="utf-8") as f:
            json.dump(canvas.model_dump(), f, ensure_ascii=False, indent=2)

        logger.info(f"Created canvas {canvas.canvas_id} for project {project_id}")
        return canvas.model_dump()

    @staticmethod
    def get_canvas(project_id: str, canvas_id: str) -> Optional[Dict]:
        """获取画布详情"""
        canvas_path = CanvasService.get_canvas_path(project_id, canvas_id)

        if not canvas_path.exists():
            return None

        with open(canvas_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def update_canvas(project_id: str, canvas_id: str, update_data: Dict) -> Optional[Dict]:
        """更新画布信息"""
        canvas_path = CanvasService.get_canvas_path(project_id, canvas_id)

        if not canvas_path.exists():
            return None

        # 读取现有数据
        with open(canvas_path, "r", encoding="utf-8") as f:
            canvas_data = json.load(f)

        # 更新字段
        if "name" in update_data:
            canvas_data["name"] = update_data["name"]
        if "description" in update_data:
            canvas_data["description"] = update_data["description"]
        if "zoom" in update_data:
            canvas_data["zoom"] = update_data["zoom"]
        if "pan_x" in update_data:
            canvas_data["pan_x"] = update_data["pan_x"]
        if "pan_y" in update_data:
            canvas_data["pan_y"] = update_data["pan_y"]
        if "elements" in update_data:
            canvas_data["elements"] = update_data["elements"]

        canvas_data["updated_at"] = datetime.now().isoformat()

        # 保存
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

