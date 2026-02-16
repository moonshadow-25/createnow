"""
请求上下文管理

使用 contextvars 存储当前请求的上下文信息，如 project_id
"""

from contextvars import ContextVar
from typing import Optional

# 当前请求的 project_id
current_project_id: ContextVar[Optional[str]] = ContextVar('current_project_id', default=None)


def get_current_project_id() -> Optional[str]:
    """获取当前请求的 project_id"""
    return current_project_id.get()


def set_current_project_id(project_id: str):
    """设置当前请求的 project_id"""
    current_project_id.set(project_id)
