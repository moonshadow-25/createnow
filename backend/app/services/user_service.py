"""
用户服务：管理 /data/config/users.json 中的管理员账号
"""
import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.security import hash_password

logger = logging.getLogger(__name__)

_USERS_PATH: Optional[Path] = None


def _get_users_path() -> Path:
    global _USERS_PATH
    if _USERS_PATH is None:
        _USERS_PATH = settings.CONFIG_DIR / "users.json"
    return _USERS_PATH


def _read_users() -> dict:
    path = _get_users_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"version": 1, "users": []}


def _write_users(data: dict) -> None:
    path = _get_users_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ============================================================
# 查询
# ============================================================

def get_user_by_username(username: str) -> Optional[dict]:
    data = _read_users()
    for user in data.get("users", []):
        if user.get("username") == username and user.get("is_active", True):
            return user
    return None


def get_user_by_id(user_id: str) -> Optional[dict]:
    data = _read_users()
    for user in data.get("users", []):
        if user.get("id") == user_id and user.get("is_active", True):
            return user
    return None


def list_users() -> list:
    """返回所有活跃用户，去掉 hashed_password，不包含超级管理员"""
    data = _read_users()
    result = []
    for user in data.get("users", []):
        if not user.get("is_active", True):
            continue
        if user.get("is_super_admin") or user.get("username") == "admin":
            continue
        u = {k: v for k, v in user.items() if k != "hashed_password"}
        result.append(u)
    return result


def create_user(username: str, password: str, display_name: str = "", assigned_project_ids: list = None) -> dict:
    """创建子账号（role=user）"""
    data = _read_users()
    # 检查用户名是否已存在
    for user in data.get("users", []):
        if user.get("username") == username and user.get("is_active", True):
            raise ValueError(f"用户名 '{username}' 已存在")

    new_user = {
        "id": str(uuid.uuid4()),
        "username": username,
        "hashed_password": hash_password(password),
        "role": "user",
        "display_name": display_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
        "is_active": True,
        "assigned_project_ids": assigned_project_ids or [],
    }
    data.setdefault("users", []).append(new_user)
    _write_users(data)
    return {k: v for k, v in new_user.items() if k != "hashed_password"}


def update_user(user_id: str, *, display_name: str = None, password: str = None, assigned_project_ids: list = None) -> Optional[dict]:
    """更新子账号信息，超级管理员密码不可修改"""
    data = _read_users()
    for user in data.get("users", []):
        if user.get("id") == user_id and user.get("is_active", True):
            if user.get("is_super_admin") or user.get("username") == "admin":
                if password:
                    raise ValueError("超级管理员密码不可修改")
            if display_name is not None:
                user["display_name"] = display_name
            if password:
                user["hashed_password"] = hash_password(password)
            if assigned_project_ids is not None:
                user["assigned_project_ids"] = assigned_project_ids
            _write_users(data)
            return {k: v for k, v in user.items() if k != "hashed_password"}
    return None


def delete_user(user_id: str) -> bool:
    """软删除用户（is_active=False），不允许删除唯一的 admin 或超级管理员"""
    data = _read_users()
    # 找到目标用户
    target = None
    for user in data.get("users", []):
        if user.get("id") == user_id and user.get("is_active", True):
            target = user
            break
    if not target:
        return False

    # 不允许删除超级管理员 admin
    if target.get("username") == "admin" or target.get("is_super_admin"):
        raise ValueError("不能删除超级管理员账号")

    # 不允许删除唯一的 admin
    if target.get("role") == "admin":
        active_admins = [u for u in data.get("users", []) if u.get("role") == "admin" and u.get("is_active", True)]
        if len(active_admins) <= 1:
            raise ValueError("不能删除唯一的管理员账号")

    target["is_active"] = False
    _write_users(data)
    return True


# ============================================================
# 更新
# ============================================================

def update_last_login(user_id: str) -> None:
    data = _read_users()
    for user in data.get("users", []):
        if user.get("id") == user_id:
            user["last_login_at"] = datetime.now(timezone.utc).isoformat()
            break
    _write_users(data)


# ============================================================
# 初始化默认管理员
# ============================================================

def ensure_default_admin() -> None:
    """启动时调用：确保默认账号存在"""
    data = _read_users()
    changed = False

    # 1. 若无任何用户，创建 menglaoshi 默认账号
    if not data.get("users"):
        admin = {
            "id": str(uuid.uuid4()),
            "username": "menglaoshi",
            "hashed_password": hash_password("menglaoshi123"),
            "role": "admin",
            "display_name": "Administrator",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_login_at": None,
            "is_active": True,
            "assigned_project_ids": None,
        }
        data["users"] = [admin]
        changed = True
        print("=" * 60)
        print("[INFO] 已创建默认管理员账号：menglaoshi / menglaoshi123")
        print("       请登录后尽快修改密码！")
        print("=" * 60)

    # 2. 始终确保超级管理员 admin 存在（不可删除的保底账号）
    has_super_admin = any(
        u.get("username") == "admin" and u.get("is_active", True)
        for u in data.get("users", [])
    )
    if not has_super_admin:
        super_admin = {
            "id": str(uuid.uuid4()),
            "username": "admin",
            "hashed_password": hash_password("870417"),
            "role": "admin",
            "display_name": "Super Admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_login_at": None,
            "is_active": True,
            "assigned_project_ids": None,
            "is_super_admin": True,
        }
        data.setdefault("users", []).append(super_admin)
        changed = True
        print("[INFO] 已创建超级管理员账号：admin")

    if changed:
        _write_users(data)
