"""
管理员认证路由
  POST /api/admin/login   — 用户名密码登录，返回 JWT
  GET  /api/admin/me      — 返回当前用户信息（需 Bearer token）
  POST /api/admin/logout  — 仅客户端清除 token
  GET    /api/admin/users         — 列出所有用户（admin only）
  POST   /api/admin/users         — 创建子账号（admin only）
  PUT    /api/admin/users/{id}    — 更新子账号（admin only）
  DELETE /api/admin/users/{id}    — 软删除子账号（admin only）
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel

from app.core.security import verify_password, create_access_token, decode_access_token
from app.services.user_service import (
    get_user_by_username, update_last_login,
    list_users, create_user, update_user, delete_user,
)

router = APIRouter(prefix="/admin", tags=["admin-auth"])

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login")


# ============================================================
# 依赖：验证 Bearer token
# ============================================================

def _get_current_user(token: str = Depends(_oauth2_scheme)) -> dict:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = get_user_by_username(payload["sub"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _require_admin(current_user: dict = Depends(_get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return current_user


# ============================================================
# Pydantic schemas
# ============================================================

class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str = ""
    assigned_project_ids: list[str] = []
    readonly: bool = False


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    password: Optional[str] = None
    assigned_project_ids: Optional[list[str]] = None
    readonly: Optional[bool] = None


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


# ============================================================
# 路由
# ============================================================

@router.post("/login")
async def admin_login(form: OAuth2PasswordRequestForm = Depends()):
    user = get_user_by_username(form.username)
    if not user or not verify_password(form.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    update_last_login(user["id"])
    token = create_access_token(user["username"], user["role"], readonly=bool(user.get("readonly")))
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
async def admin_me(current_user: dict = Depends(_get_current_user)):
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "role": current_user["role"],
        "display_name": current_user.get("display_name"),
        "last_login_at": current_user.get("last_login_at"),
    }


@router.post("/logout")
async def admin_logout():
    return {"success": True}


@router.put("/me/password")
async def change_my_password(body: PasswordChange, current_user: dict = Depends(_get_current_user)):
    if current_user.get("is_super_admin") or current_user.get("username") == "admin":
        raise HTTPException(status_code=403, detail="超级管理员密码不可修改")
    if not verify_password(body.old_password, current_user["hashed_password"]):
        raise HTTPException(status_code=400, detail="原密码错误")
    result = update_user(current_user["id"], password=body.new_password)
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


# ============================================================
# 用户管理路由（admin only）
# ============================================================

@router.get("/users")
async def admin_list_users(_admin: dict = Depends(_require_admin)):
    return list_users()


@router.post("/users", status_code=201)
async def admin_create_user(body: UserCreate, _admin: dict = Depends(_require_admin)):
    try:
        return create_user(body.username, body.password, body.display_name, body.assigned_project_ids, body.readonly)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/users/{user_id}")
async def admin_update_user(user_id: str, body: UserUpdate, _admin: dict = Depends(_require_admin)):
    try:
        result = update_user(
            user_id,
            display_name=body.display_name,
            password=body.password,
            assigned_project_ids=body.assigned_project_ids,
            readonly=body.readonly,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return result


@router.post("/cache/clear")
async def admin_clear_cache(
    project_id: str = None,
    _user: dict = Depends(_get_current_user),
):
    """
    清除后端内存缓存。
    - project_id 为空：清除所有项目缓存
    - project_id 有值：仅清除该项目缓存
    """
    from app.services.asset_service import _assets_cache, _images_cache

    if project_id:
        assets_cleared = bool(_assets_cache.pop(project_id, None))
        images_cleared = bool(_images_cache.pop(project_id, None))
        return {
            "success": True,
            "project_id": project_id,
            "assets_cache_cleared": assets_cleared,
            "images_cache_cleared": images_cleared,
        }
    else:
        assets_count = len(_assets_cache)
        images_count = len(_images_cache)
        _assets_cache.clear()
        _images_cache.clear()
        return {
            "success": True,
            "project_id": None,
            "assets_projects_cleared": assets_count,
            "images_projects_cleared": images_count,
        }


@router.delete("/users/{user_id}")
async def admin_delete_user(user_id: str, current_admin: dict = Depends(_require_admin)):
    # 不允许删除自己
    if user_id == current_admin.get("id"):
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    try:
        success = delete_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}
