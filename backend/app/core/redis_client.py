"""
Redis 客户端单例 —— SaaS 模式下用于用户存储和 Session 管理。

selfhosted 模式下此模块不会被调用。
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_redis = None


async def get_redis():
    """获取 Redis 连接（懒初始化）"""
    global _redis
    if _redis is None:
        try:
            import redis.asyncio as aioredis
            from app.core.config import settings
            _redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
            )
            await _redis.ping()
            logger.info(f"[Redis] Connected to {settings.REDIS_URL}")
        except Exception as e:
            logger.error(f"[Redis] Connection failed: {e}")
            raise
    return _redis


async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
        logger.info("[Redis] Connection closed")
