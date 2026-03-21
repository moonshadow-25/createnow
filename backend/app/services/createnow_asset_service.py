"""
CreateNow Asset 服务

将图片提交到 CreateNow 素材库，获取 asset_id 后在视频生成时使用 asset:// URI。
使用 Bearer API key 鉴权，提交 data URI 格式的图片。

API：
  POST /v1/assets          提交素材
  GET  /v1/assets/:id      查询状态
"""

import base64
import logging
import mimetypes
import os
from typing import Optional, Dict, Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def get_api_key_and_url() -> tuple[str, str]:
    """从 global.json 读取 API key，base URL 使用 CREATENOW_BASE_URL（含 /v1）"""
    from app.services.auth_service import get_auth_state
    auth = get_auth_state()
    api_key = auth.get("api_key", "")
    api_url = settings.CREATENOW_BASE_URL  # e.g. http://47.117.182.216:8003/v1
    return api_key, api_url


async def read_image_as_base64_datauri(image_path: str) -> Optional[str]:
    """将图片读取为 data URI 字符串（data:image/png;base64,...）

    本地绝对路径优先，http(s) URL 降级下载。
    """
    data: Optional[bytes] = None

    if image_path.startswith(("http://", "https://")):
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(image_path)
                resp.raise_for_status()
                data = resp.content
        except Exception as e:
            logger.error(f"[CreatenowAsset] 下载图片失败 {image_path}: {e}")
            return None
    else:
        if not os.path.exists(image_path):
            logger.warning(f"[CreatenowAsset] 本地文件不存在: {image_path}")
            return None
        try:
            with open(image_path, "rb") as f:
                data = f.read()
        except Exception as e:
            logger.error(f"[CreatenowAsset] 读取本地文件失败 {image_path}: {e}")
            return None

    if not data:
        return None

    mime, _ = mimetypes.guess_type(image_path)
    if not mime:
        mime = "image/png"
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:{mime};base64,{b64}"


async def create_asset(image_datauri: str, api_key: str, api_url: str) -> str:
    """将图片提交到 CreateNow 素材库，返回 asset_id

    POST {api_url}/assets
    Body: { "image": "data:..." }
    """
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{api_url}/assets",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"image": image_datauri},
        )
        resp.raise_for_status()
        data = resp.json()
        asset_id = data.get("asset_id") or data.get("id")
        if not asset_id:
            raise ValueError(f"无法从响应中获取 asset_id: {data}")
        logger.info(f"[CreatenowAsset] 提交素材成功: {asset_id}")
        return asset_id


async def get_asset_status(asset_id: str, api_key: str, api_url: str) -> Dict[str, Any]:
    """查询素材状态

    GET {api_url}/assets/{asset_id}
    返回 {"status": "Processing"|"Active"|"Failed", "url": str|None}
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{api_url}/assets/{asset_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "status": data.get("status", "Processing"),
            "url": data.get("url") or data.get("public_url"),
        }
