"""
请求上下文管理

使用 contextvars 存储当前请求的上下文信息，如 project_id
"""

from contextvars import ContextVar
from pathlib import Path
from typing import Optional

# 当前请求的 project_id
current_project_id: ContextVar[Optional[str]] = ContextVar('current_project_id', default=None)

# 当前请求的用户名（用于生成记录的 created_by 归属）
current_user: ContextVar[Optional[str]] = ContextVar('current_user', default=None)

# SaaS 模式：当前用户的数据根目录（data/users/{user_id}/）
# selfhosted 模式下此值为 None，由 asset_service 回退到 settings.PROJECTS_DIR
current_data_root: ContextVar[Optional[Path]] = ContextVar('current_data_root', default=None)


def get_current_project_id() -> Optional[str]:
    """获取当前请求的 project_id"""
    return current_project_id.get()


def set_current_project_id(project_id: str):
    """设置当前请求的 project_id"""
    current_project_id.set(project_id)


def get_current_user() -> Optional[str]:
    """获取当前请求的用户名"""
    return current_user.get()


def set_current_user(username: Optional[str]):
    """设置当前请求的用户名"""
    current_user.set(username)


def get_current_data_root() -> Optional[Path]:
    """获取当前请求的数据根目录（SaaS 模式返回用户目录，selfhosted 返回 None）"""
    return current_data_root.get()


def set_current_data_root(path: Optional[Path]):
    """设置当前请求的数据根目录"""
    current_data_root.set(path)
