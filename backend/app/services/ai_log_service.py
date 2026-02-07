"""AI交互日志服务"""
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)


class AILogService:
    """AI交互日志服务 - 记录所有与AI的交互"""

    # 日志类型
    TYPE_LLM = "llm"
    TYPE_IMAGE = "image"
    TYPE_VIDEO = "video"

    @staticmethod
    def _get_log_file(project_id: str) -> Path:
        """获取项目的AI日志文件路径"""
        project_dir = settings.PROJECTS_DIR / project_id
        log_dir = project_dir / "ai_logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / "interactions.jsonl"

    @staticmethod
    def log_interaction(
        project_id: str,
        interaction_type: str,
        request_data: Dict,
        response_data: Optional[Dict] = None,
        error: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """
        记录AI交互日志

        Args:
            project_id: 项目ID
            interaction_type: 交互类型 (llm/image/video)
            request_data: 请求数据
            response_data: 响应数据（如果成功）
            error: 错误信息（如果失败）
            metadata: 额外的元数据（如model、api_url等）

        Returns:
            记录的日志条目
        """
        log_entry = {
            "id": f"{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            "timestamp": datetime.now().isoformat(),
            "type": interaction_type,
            "request": request_data,
            "success": error is None,
        }

        if response_data:
            log_entry["response"] = response_data

        if error:
            log_entry["error"] = error

        if metadata:
            log_entry["metadata"] = metadata

        # 写入日志文件
        try:
            log_file = AILogService._get_log_file(project_id)
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"Failed to write AI log: {e}")

        return log_entry

    @staticmethod
    def get_logs(
        project_id: str,
        interaction_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict]:
        """
        获取项目的AI交互日志

        Args:
            project_id: 项目ID
            interaction_type: 过滤类型 (llm/image/video)，None表示全部
            limit: 返回条数限制
            offset: 偏移量

        Returns:
            日志条目列表，按时间倒序
        """
        log_file = AILogService._get_log_file(project_id)

        if not log_file.exists():
            return []

        logs = []
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        entry = json.loads(line)
                        # 类型过滤
                        if interaction_type is None or entry.get("type") == interaction_type:
                            logs.append(entry)
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            logger.error(f"Failed to read AI logs: {e}")

        # 按时间倒序排序
        logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        # 分页
        return logs[offset:offset + limit]

    @staticmethod
    def get_log_count(project_id: str, interaction_type: Optional[str] = None) -> int:
        """获取日志总数"""
        return len(AILogService.get_logs(project_id, interaction_type, limit=999999))

    @staticmethod
    def clear_logs(project_id: str, interaction_type: Optional[str] = None) -> Dict:
        """
        清除日志

        Args:
            project_id: 项目ID
            interaction_type: 要清除的类型，None表示全部清除
        """
        log_file = AILogService._get_log_file(project_id)

        if not log_file.exists():
            return {"deleted": 0}

        if interaction_type is None:
            # 全部清除
            count = AILogService.get_log_count(project_id)
            log_file.unlink()
            return {"deleted": count}
        else:
            # 按类型过滤清除
            logs = AILogService.get_logs(project_id)
            filtered_logs = [log for log in logs if log.get("type") != interaction_type]
            count = len(logs) - len(filtered_logs)

            # 重写文件
            if filtered_logs:
                with open(log_file, "w", encoding="utf-8") as f:
                    for log in filtered_logs:
                        f.write(json.dumps(log, ensure_ascii=False) + "\n")
            else:
                log_file.unlink()

            return {"deleted": count}
