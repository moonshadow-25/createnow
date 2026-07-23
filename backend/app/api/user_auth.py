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
import io
import json
import logging
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.responses import Response

from app.core.config import settings
from app.services.auth_service import get_saas_login_url, check_saas_status, fetch_saas_credits
from app.services import user_saas_service
from app.services.createnow_model_config import get_createnow_model_config
from app.core.saas_security import create_saas_token

router = APIRouter(prefix="/user", tags=["user-auth"])

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_SKILL_TEMPLATE_DIR = _PROJECT_ROOT / "skills" / "createnow-image"
_SKILL_TEMPLATE_FILES = {
    "createnow-image/SKILL.md": _SKILL_TEMPLATE_DIR / "SKILL.md",
    "createnow-image/.gitignore": _SKILL_TEMPLATE_DIR / ".gitignore",
    "createnow-image/scripts/createnow_image.py": _SKILL_TEMPLATE_DIR / "scripts" / "createnow_image.py",
}


def _dotenv_value(value: object) -> str:
    """Quote a dotenv value without allowing additional configuration entries."""
    escaped = str(value or "").replace("\\", "\\\\")
    escaped = escaped.replace('"', '\\"').replace("\r", "\\r").replace("\n", "\\n")
    return f'"{escaped}"'


def _build_createnow_image_skill_zip(api_key: str) -> bytes:
    """Build the fixed CreateNow image skill package entirely in memory."""
    model_config = get_createnow_model_config()
    image_models = model_config["suggestions"]["image"]
    default_model = model_config["default_models"]["image"]
    models_json = json.dumps(
        {"models": image_models, "default_model": default_model},
        ensure_ascii=False,
        indent=2,
    )
    dotenv = "\n".join((
        f"CREATENOW_API_KEY={_dotenv_value(api_key)}",
        f"CREATENOW_API_BASE_URL={_dotenv_value(settings.CREATENOW_BASE_URL)}",
        f"CREATENOW_IMAGE_MODEL={_dotenv_value(default_model)}",
        "",
    ))

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for archive_path, template_path in _SKILL_TEMPLATE_FILES.items():
            package.writestr(archive_path, template_path.read_bytes())
        package.writestr("createnow-image/.env", dotenv.encode("utf-8"))
        package.writestr("createnow-image/models.json", models_json.encode("utf-8"))
    return archive.getvalue()


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
    registered, api_key, email, display_name, credits = await check_saas_status(body.session_id)
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

    # 同步更新该用户所有已有项目的 api_key
    await user_saas_service.update_all_project_keys(user["user_id"], api_key)

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
            "credits": credits,
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


@router.get("/credits")
async def get_credits(request: Request):
    """查询当前用户积分（实时从 CreateNow 平台获取）"""
    user = getattr(request.state, "saas_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    api_key = user.get("api_key", "")
    if not api_key:
        return {"credits": None}
    credits = await fetch_saas_credits(api_key)
    return {"credits": credits}


@router.get("/skills/createnow-image.zip")
async def download_createnow_image_skill(request: Request):
    """Download a configured CreateNow image skill for the authenticated SaaS user."""
    user = getattr(request.state, "saas_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    api_key = str(user.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=409, detail="CreateNow API key is unavailable for this account")

    try:
        content = _build_createnow_image_skill_zip(api_key)
    except OSError:
        logger.exception("Unable to prepare CreateNow image skill template")
        raise HTTPException(status_code=500, detail="CreateNow image skill is temporarily unavailable")

    return Response(
        content=content,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="createnow-image-skill.zip"',
            "Cache-Control": "private, no-store",
            "Pragma": "no-cache",
        },
    )


# ============================================================
# 注销
# ============================================================

@router.post("/logout")
async def logout(request: Request):
    payload = getattr(request.state, "saas_token_payload", None)
    if payload and payload.get("jti"):
        await user_saas_service.revoke_session(payload["jti"])
    return {"success": True}
