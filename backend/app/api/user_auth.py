"""
SaaS 用户认证 API

端点：
  GET  /api/user/auth/start    — 生成 SaaS 登录 URL（前端传 session_id，无需硬件）
  POST /api/user/auth/poll     — 用 session_id 轮询外部登录状态，换取内部 JWT
  GET  /api/user/me            — 获取当前用户信息
  POST /api/user/logout        — 注销（撤销 session）

SaaS 登录流程：
  1. 前端生成随机 session_id（crypto.randomUUID()）
  2. 前端调用 GET /api/user/auth/start?session_id={session_id} 获取登录 URL
  3. 用户在 CreateNow 完成登录
  4. 前端轮询 POST /api/user/auth/poll { session_id }
     - 后端用 session_id 查询外部 API 状态
     - 成功后在 Redis 创建/更新用户，颁发内部 JWT

PaaS 认证（/api/auth/*）完全不受影响。
"""
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.auth_service import get_saas_login_url, check_saas_status
from app.services import user_saas_service
from app.core.saas_security import create_saas_token

router = APIRouter(prefix="/user", tags=["user-auth"])

logger = logging.getLogger(__name__)


# ============================================================
# SaaS 登录 URL 生成
# ============================================================

@router.get("/auth/start")
async def saas_auth_start(session_id: str):
    """
    根据前端传入的 session_id 生成 CreateNow 登录 URL。
    前端自行生成 session_id（crypto.randomUUID()），无需硬件信息。
    """
    url = get_saas_login_url(session_id)
    return {"url": url}


# ============================================================
# 轮询外部状态 → 颁发内部 JWT
# ============================================================

class PollRequest(BaseModel):
    session_id: str


@router.post("/auth/poll")
async def poll_and_login(body: PollRequest):
    """
    用 session_id 轮询 CreateNow 平台登录状态。
    若已激活，在 Redis 创建/更新用户，返回内部 JWT。
    """
    registered, api_key, email, display_name = await check_saas_status(body.session_id)
    if not registered or not api_key:
        return {"registered": False}

    # external_id 用 user_name（即邮箱）做去重，同一用户多次登录不创建多个账号
    external_id = email or body.session_id
    user = await user_saas_service.login_or_create(
        external_id=external_id,
        api_key=api_key,
        display_name=display_name or email or "",
        email=email or "",
    )

    jti = await user_saas_service.create_session(user["user_id"])
    token = create_saas_token(
        user_id=user["user_id"],
        jti=jti,
        display_name=user.get("display_name", ""),
    )

    return {
        "registered": True,
        "token": token,
        "user": {
            "user_id": user["user_id"],
            "display_name": user.get("display_name", ""),
            "email": user.get("email", ""),
        }
    }


# ============================================================
# 当前用户信息
# ============================================================

@router.get("/me")
async def get_me(request: Request):
    user = getattr(request.state, "saas_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "user_id": user["user_id"],
        "display_name": user.get("display_name", ""),
        "email": user.get("email", ""),
        "created_at": user.get("created_at", ""),
        "last_login_at": user.get("last_login_at", ""),
    }


# ============================================================
# 注销
# ============================================================

@router.post("/logout")
async def logout(request: Request):
    payload = getattr(request.state, "saas_token_payload", None)
    if payload and payload.get("jti"):
        await user_saas_service.revoke_session(payload["jti"])
    return {"success": True}
