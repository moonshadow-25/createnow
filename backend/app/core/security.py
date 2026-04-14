"""
安全工具：密码哈希、JWT 生成与验证
"""
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

# JWT 配置
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRE_DAYS = 7


# ============================================================
# JWT Secret 持久化（存入 global.json）
# ============================================================

def _get_jwt_secret() -> str:
    """从 global.json 获取 JWT secret；若不存在则自动生成并保存"""
    from app.services import auth_service  # 复用现有读写逻辑，避免循环导入

    config = auth_service._read_global_config()
    secret = config.get("admin_jwt_secret")
    if not secret:
        secret = secrets.token_hex(32)
        config["admin_jwt_secret"] = secret
        auth_service._write_global_config(config)
        logger.info("[Security] 已生成新的 admin_jwt_secret 并写入 global.json")
    return secret


# ============================================================
# 密码
# ============================================================

def hash_password(plain: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ============================================================
# JWT
# ============================================================

def create_access_token(username: str, role: str, readonly: bool = False) -> str:
    secret = _get_jwt_secret()
    expire = datetime.now(timezone.utc) + timedelta(days=_JWT_EXPIRE_DAYS)
    payload = {
        "sub": username,
        "role": role,
        "readonly": readonly,
        "exp": expire,
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """验证并解码 JWT；失败返回 None"""
    try:
        secret = _get_jwt_secret()
        return jwt.decode(token, secret, algorithms=[_JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        logger.debug("[Security] Token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.debug(f"[Security] Invalid token: {e}")
        return None
