"""
SaaS 用户服务 —— 基于 Redis 的用户存储和 Session 管理。

数据结构：
  user:{user_id}          Hash  { external_id, api_key, display_name, email, created_at, last_login_at }
  user_ext:{external_id}  String → user_id（索引）
  user_projects:{user_id} Set   → { project_id, ... }
  session:{jti}           String → user_id  (TTL=7天)
  blacklist:{jti}         String → 1        (TTL=7天，支持即时注销)
"""
import json
import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.core.redis_client import get_redis
from app.core.config import settings

logger = logging.getLogger(__name__)

_SESSION_TTL = 7 * 24 * 3600  # 7 天（秒）


# ============================================================
# 用户 CRUD
# ============================================================

async def get_user_by_id(user_id: str) -> Optional[dict]:
    r = await get_redis()
    data = await r.hgetall(f"user:{user_id}")
    return data if data else None


async def get_user_by_external_id(external_id: str) -> Optional[dict]:
    r = await get_redis()
    user_id = await r.get(f"user_ext:{external_id}")
    if not user_id:
        return None
    return await get_user_by_id(user_id)


async def create_user(external_id: str, api_key: str, display_name: str = "", email: str = "") -> dict:
    r = await get_redis()
    user_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    user = {
        "user_id": user_id,
        "external_id": external_id,
        "api_key": api_key,
        "display_name": display_name,
        "email": email,
        "created_at": now,
        "last_login_at": now,
    }
    await r.hset(f"user:{user_id}", mapping=user)
    await r.set(f"user_ext:{external_id}", user_id)
    logger.info(f"[UserService] Created user {user_id} (ext={external_id[:8]}...)")
    return user


async def update_user_login(user_id: str, api_key: str) -> None:
    """登录时更新 api_key 和 last_login_at"""
    r = await get_redis()
    await r.hset(f"user:{user_id}", mapping={
        "api_key": api_key,
        "last_login_at": datetime.now().isoformat(),
    })


async def login_or_create(external_id: str, api_key: str, display_name: str = "", email: str = "") -> dict:
    """登录：已有用户则更新，新用户则创建"""
    existing = await get_user_by_external_id(external_id)
    if existing:
        await update_user_login(existing["user_id"], api_key)
        existing["api_key"] = api_key
        existing["last_login_at"] = datetime.now().isoformat()
        return existing
    return await create_user(external_id, api_key, display_name, email)


# ============================================================
# 项目索引
# ============================================================

async def add_user_project(user_id: str, project_id: str) -> None:
    r = await get_redis()
    await r.sadd(f"user_projects:{user_id}", project_id)


async def remove_user_project(user_id: str, project_id: str) -> None:
    r = await get_redis()
    await r.srem(f"user_projects:{user_id}", project_id)


async def get_user_project_ids(user_id: str) -> list:
    r = await get_redis()
    return list(await r.smembers(f"user_projects:{user_id}"))


# ============================================================
# Session 管理
# ============================================================

async def create_session(user_id: str) -> str:
    """创建 Session，返回 jti（JWT ID）"""
    r = await get_redis()
    jti = str(uuid.uuid4())
    await r.set(f"session:{jti}", user_id, ex=_SESSION_TTL)
    return jti


async def get_session_user_id(jti: str) -> Optional[str]:
    """验证 Session，返回 user_id；无效则 None"""
    r = await get_redis()
    # 检查黑名单
    if await r.exists(f"blacklist:{jti}"):
        return None
    return await r.get(f"session:{jti}")


async def revoke_session(jti: str) -> None:
    """注销：加入黑名单，同时删除 session 键"""
    r = await get_redis()
    await r.set(f"blacklist:{jti}", "1", ex=_SESSION_TTL)
    await r.delete(f"session:{jti}")
    logger.info(f"[UserService] Session revoked: {jti[:8]}...")


async def update_all_project_keys(user_id: str, new_api_key: str) -> int:
    """登录时同步更新用户所有项目中的 api_key。

    SaaS 用户不允许手动修改 key，所以无脑覆盖即可。
    返回更新的项目数。
    """
    projects_dir = settings.USERS_DIR / user_id / "projects"
    if not projects_dir.exists():
        return 0

    updated = 0
    AI_SERVICES = ("llm", "vlm", "image", "video", "tts")

    for project_dir in projects_dir.iterdir():
        meta_path = project_dir / "metadata.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            ai_config = meta.get("ai_config", {})
            changed = False
            for svc in AI_SERVICES:
                if svc in ai_config and ai_config[svc].get("api_key"):
                    ai_config[svc]["api_key"] = new_api_key
                    changed = True
            if changed:
                meta_path.write_text(
                    json.dumps(meta, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                updated += 1
        except (json.JSONDecodeError, OSError):
            logger.warning(f"[UserService] Failed to update api_key in {meta_path}", exc_info=True)

    if updated:
        logger.info(f"[UserService] Updated api_key in {updated} projects for user {user_id}")
    return updated
