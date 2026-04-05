"""
SaaS 用户 JWT —— 独立于现有 admin JWT，避免互相干扰。

payload 格式：
  { "sub": user_id, "jti": session_id, "type": "saas_user", "exp": ... }
"""
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_DAYS = 7
_SAAS_JWT_SECRET_KEY = "saas_jwt_secret"


def _get_saas_jwt_secret() -> str:
    """从 global.json 获取 SaaS JWT secret，不存在则生成"""
    from app.services import auth_service
    config = auth_service._read_global_config()
    secret = config.get(_SAAS_JWT_SECRET_KEY)
    if not secret:
        secret = secrets.token_hex(32)
        config[_SAAS_JWT_SECRET_KEY] = secret
        auth_service._write_global_config(config)
        logger.info("[SaaSSecurity] 已生成新的 saas_jwt_secret")
    return secret


def create_saas_token(user_id: str, jti: str, display_name: str = "") -> str:
    secret = _get_saas_jwt_secret()
    expire = datetime.now(timezone.utc) + timedelta(days=_JWT_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "jti": jti,
        "type": "saas_user",
        "exp": expire,
        "display_name": display_name,
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)


def decode_saas_token(token: str) -> Optional[dict]:
    try:
        secret = _get_saas_jwt_secret()
        payload = jwt.decode(token, secret, algorithms=[_JWT_ALGORITHM])
        if payload.get("type") != "saas_user":
            return None
        return payload
    except jwt.ExpiredSignatureError:
        logger.debug("[SaaSSecurity] Token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.debug(f"[SaaSSecurity] Invalid token: {e}")
        return None
