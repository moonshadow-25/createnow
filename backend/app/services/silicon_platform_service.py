"""
硅星人数字资产平台服务层

封装 SDK 调用、凭证管理、图片下载。
凭证从项目 metadata (silicon_credentials) 读取。
"""
import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from app.core.config import settings
from app.services.asset_service import AssetService, ImageService, ProjectService, _get_projects_dir
from app.services.silicon_sdk import SiliconClient

logger = logging.getLogger(__name__)

SILICON_PUBLIC_BASE = "https://ai.npaigc.com"


class SiliconPlatformError(Exception):
    """硅星人平台调用异常"""

    def __init__(self, message: str, code: Optional[int] = None):
        self.code = code
        super().__init__(message)


def _read_metadata(project_id: str) -> Dict[str, Any]:
    """直接读取项目 metadata.json（绕过 Project 模型，读取所有字段）"""
    projects_dir = _get_projects_dir()
    metadata_path = projects_dir / project_id / "metadata.json"
    if not metadata_path.exists():
        raise SiliconPlatformError("项目不存在", code=404)
    with open(metadata_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_metadata(project_id: str, metadata: Dict[str, Any]) -> None:
    """直接写入项目 metadata.json"""
    projects_dir = _get_projects_dir()
    metadata_path = projects_dir / project_id / "metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)


class SiliconPlatformService:
    """硅星人平台服务层。公开 API 直接 HTTP 调用，付费 API 走 SDK。"""

    # ═══════════════════════════════════════════════════════════════
    # 凭证管理（直接读写 metadata.json，不依赖 Project 模型）
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def get_credentials(project_id: str) -> Optional[Dict[str, str]]:
        """获取项目的硅星人平台凭证（不暴露 app_secret 完整值）"""
        try:
            metadata = _read_metadata(project_id)
            creds = metadata.get("silicon_credentials")
            if not creds or not creds.get("app_id"):
                return None
            return {
                "app_id": creds["app_id"],
                "has_secret": bool(creds.get("app_secret")),
            }
        except SiliconPlatformError:
            return None

    @staticmethod
    def save_credentials(project_id: str, app_id: str, app_secret: str) -> None:
        """保存平台凭证到项目 metadata.json"""
        metadata = _read_metadata(project_id)
        metadata["silicon_credentials"] = {
            "app_id": app_id.strip(),
            "app_secret": app_secret.strip(),
        }
        _write_metadata(project_id, metadata)

    @staticmethod
    def _get_client(project_id: str) -> SiliconClient:
        """从项目 metadata 读取 silicon_credentials 构建客户端"""
        metadata = _read_metadata(project_id)
        creds = metadata.get("silicon_credentials")
        if not creds or not creds.get("app_id") or not creds.get("app_secret"):
            raise SiliconPlatformError(
                "项目未配置硅星人平台凭证，请在项目设置中绑定 app_id 和 app_secret",
                code=400,
            )

        return SiliconClient(
            app_id=creds["app_id"],
            app_secret=creds["app_secret"],
            base_url=SILICON_PUBLIC_BASE,
        )

    # ═══════════════════════════════════════════════════════════════
    # 公开 API（无需 HMAC 签名）
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def list_talents(
        search: Optional[str] = None,
        ordering: str = "-total_revenue",
        level: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        """艺人列表（公开 API）"""
        params: Dict[str, Any] = {
            "ordering": ordering,
            "page": page,
            "page_size": page_size,
        }
        if search:
            params["search"] = search
        if level:
            params["level"] = level

        try:
            resp = requests.get(
                f"{SILICON_PUBLIC_BASE}/api/talents/",
                params=params,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            # 此公开接口无统一 code 字段，直接返回分页数据
            return {
                "count": data.get("count", 0),
                "next": data.get("next"),
                "previous": data.get("previous"),
                "results": data.get("results", []),
            }
        except requests.RequestException as e:
            logger.error(f"[SiliconPlatform] list_talents error: {e}")
            raise SiliconPlatformError(f"获取艺人列表失败: {e}")

    @staticmethod
    def get_talent(talent_id: int) -> Dict[str, Any]:
        """艺人详情（公开 API）"""
        try:
            resp = requests.get(
                f"{SILICON_PUBLIC_BASE}/api/talents/{talent_id}/",
                timeout=15,
            )
            resp.raise_for_status()
            result = resp.json()
            if result.get("code") != 0:
                raise SiliconPlatformError(
                    result.get("message", "未知错误"), code=result.get("code")
                )
            return result.get("data", {})
        except requests.RequestException as e:
            logger.error(f"[SiliconPlatform] get_talent error: {e}")
            raise SiliconPlatformError(f"获取艺人详情失败: {e}")

    # ═══════════════════════════════════════════════════════════════
    # 开放 API v1（HMAC 签名，走 SDK）
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def get_talent_assets(project_id: str, talent_id: int) -> Dict[str, Any]:
        """按艺人获取资产分组（开放 API v1）"""
        client = SiliconPlatformService._get_client(project_id)
        try:
            return client.assets.by_talent(talent_id)
        except Exception as e:
            logger.error(f"[SiliconPlatform] get_talent_assets error: {e}")
            raise SiliconPlatformError(f"获取艺人资产失败: {e}")

    @staticmethod
    def acquire_and_download(
        project_id: str,
        asset_id: str,
        role_type: str,
        character_id: str,
        project_name: str = "",
    ) -> Dict[str, Any]:
        """付费获取资产 + 下载原图到本地 + 设置角色主图。

        request_id 格式 {project_id}:{character_id}:{asset_id} 保证幂等，
        同一项目+同一角色+同一平台资产重复调用不重复扣费。
        """
        client = SiliconPlatformService._get_client(project_id)

        # 1. 付费获取原图 URL
        try:
            result = client.calls.acquire(
                asset_id=asset_id,
                role_type=role_type,
                project_name=project_name or project_id,
                project_type="AI短剧",
                request_id=f"{project_id}:{character_id}:{asset_id}",
            )
        except Exception as e:
            logger.error(f"[SiliconPlatform] acquire error: {e}")
            raise SiliconPlatformError(f"获取资产失败: {e}")

        asset_url = result.get("asset_url")
        if not asset_url:
            raise SiliconPlatformError("平台未返回资产下载链接")

        # 2. 下载原图到本地 project/images/files/
        local_path = _download_image_to_project(project_id, asset_url)

        # 3. 创建 ImageRecord（普通图片，无任何特殊标记）
        image = ImageService.create_image_from_file(
            project_id=project_id,
            asset_id=character_id,
            asset_type="character",
            local_file_path=local_path,
            prompt=f"硅星人平台导入: {result.get('asset_name', asset_id)}",
            is_primary=True,
        )

        # 4. 设为角色主图
        AssetService.update_asset_image(
            project_id, "character", character_id, image["image_id"]
        )

        logger.info(
            f"[SiliconPlatform] acquire success | "
            f"project={project_id[:8]} character={character_id[:8]} "
            f"asset={asset_id[:8]} cost={result.get('cost')} "
            f"call_id={result.get('call_id')}"
        )

        return {
            "image_id": image["image_id"],
            "local_path": local_path,
            "call_id": result.get("call_id"),
            "asset_name": result.get("asset_name"),
            "cost": result.get("cost"),
            "balance_after": result.get("balance_after"),
        }


# ═══════════════════════════════════════════════════════════════
# 内部工具函数
# ═══════════════════════════════════════════════════════════════

def _download_image_to_project(project_id: str, url: str) -> str:
    """下载远程图片到 project/images/files/，返回相对路径"""
    projects_dir = _get_projects_dir()
    images_files_dir = projects_dir / project_id / "images" / "files"
    images_files_dir.mkdir(parents=True, exist_ok=True)

    # 用 URL 的 SHA256 作为文件名（去重，避免重复下载同一 URL）
    url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
    ext = _guess_extension(url)
    filename = f"silicon_{url_hash}{ext}"
    dest = images_files_dir / filename

    # 如果已存在则跳过下载
    if not dest.exists():
        try:
            resp = requests.get(url, timeout=60, stream=True)
            resp.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
        except requests.RequestException as e:
            logger.error(f"[SiliconPlatform] download error: {url} -> {e}")
            raise SiliconPlatformError(f"下载图片失败: {e}")

    return filename


def _guess_extension(url: str) -> str:
    """从 URL 猜测文件扩展名"""
    path = url.split("?")[0]
    _, ext = os.path.splitext(path)
    if ext.lower() in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return ext.lower()
    return ".jpg"
