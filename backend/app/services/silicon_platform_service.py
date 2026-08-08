"""
硅星人数字资产平台服务层

封装 SDK 调用、凭证管理、图片下载。
凭证从项目 metadata (silicon_credentials) 读取。
"""
import hashlib
import json
import logging
import os
from typing import Any, Dict, Optional

import requests

from app.services.asset_service import AssetService, ImageService, _get_projects_dir
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
    # 艺人查询（开放 API v1，HMAC 签名，走 SDK）
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def list_talents(
        project_id: str,
        keyword: Optional[str] = None,
        ordering: str = "-total_revenue",
        level: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        """艺人列表（开放 API v1）"""
        client = SiliconPlatformService._get_client(project_id)
        try:
            return client.talents.list(
                keyword=keyword,
                level=level,
                ordering=ordering,
                page=page,
                page_size=page_size,
            )
        except Exception as e:
            logger.error(f"[SiliconPlatform] list_talents error: {e}")
            raise SiliconPlatformError(f"获取艺人列表失败: {e}")

    @staticmethod
    def get_talent(project_id: str, talent_id: int) -> Dict[str, Any]:
        """艺人详情（开放 API v1）"""
        client = SiliconPlatformService._get_client(project_id)
        try:
            return client.talents.get(talent_id)
        except Exception as e:
            logger.error(f"[SiliconPlatform] get_talent error: {e}")
            raise SiliconPlatformError(f"获取艺人详情失败: {e}")

    # ═══════════════════════════════════════════════════════════════
    # 付费获取（开放 API v1，HMAC 签名，走 SDK）
    # ═══════════════════════════════════════════════════════════════

    @staticmethod
    def acquire_talent_and_download(
        project_id: str,
        talent_id: int,
        role_type: str,
        character_id: str,
    ) -> Dict[str, Any]:
        """按艺人批量付费获取全部三视图 + 下载到本地 + 关联角色图片。

        project_name 传项目 ID，平台据此去重（同项目同资产不重复收费）；
        request_id 格式 {project_id}:{character_id}:{talent_id} 保证幂等。
        所有下载的图片均为普通图片记录，第一张设为主图。
        """
        client = SiliconPlatformService._get_client(project_id)

        # 1. 批量付费获取三视图下载链接
        try:
            result = client.calls.acquire_talent(
                talent_id=talent_id,
                role_type=role_type,
                project_name=project_id,
                project_type="AI短剧",
                request_id=f"{project_id}:{character_id}:{talent_id}",
            )
        except Exception as e:
            logger.error(f"[SiliconPlatform] acquire_talent error: {e}")
            raise SiliconPlatformError(f"获取艺人资产失败: {e}")

        items = result.get("items") or []
        if not items:
            raise SiliconPlatformError("平台未返回任何资产下载链接")

        # 2. 逐个下载 + 创建图片记录（第一张设为主图）
        downloaded: list = []
        for index, item in enumerate(items):
            asset_url = item.get("asset_url")
            asset_id = item.get("asset_id", "")
            if not asset_url:
                continue

            local_path = _download_image_to_project(project_id, asset_url, asset_id)
            image = ImageService.create_image_from_file(
                project_id=project_id,
                asset_id=character_id,
                asset_type="character",
                local_file_path=local_path,
                prompt=f"硅星人平台导入: {item.get('asset_name', '') or result.get('talent_name', '')}",
                is_primary=(index == 0),
            )
            downloaded.append({
                "image_id": image["image_id"],
                "local_path": local_path,
                "asset_id": asset_id,
                "asset_name": item.get("asset_name", ""),
                "sub_type": item.get("sub_type", ""),
            })

        if not downloaded:
            raise SiliconPlatformError("资产下载全部失败")

        # 3. 设置角色主图为第一张
        AssetService.update_asset_image(
            project_id, "character", character_id, downloaded[0]["image_id"]
        )

        logger.info(
            f"[SiliconPlatform] acquire_talent success | "
            f"project={project_id[:8]} character={character_id[:8]} "
            f"talent={talent_id} downloaded={len(downloaded)} "
            f"charged={result.get('charged_assets')} total_cost={result.get('total_cost')}"
        )

        return {
            "talent_id": result.get("talent_id"),
            "talent_name": result.get("talent_name"),
            "role_type": result.get("role_type"),
            "total_assets": result.get("total_assets"),
            "charged_assets": result.get("charged_assets"),
            "total_cost": result.get("total_cost"),
            "balance_after": result.get("balance_after"),
            "images": downloaded,
        }


# ═══════════════════════════════════════════════════════════════
# 内部工具函数
# ═══════════════════════════════════════════════════════════════

def _download_image_to_project(project_id: str, url: str, asset_id: str = "", asset_type: str = "character") -> str:
    """下载远程图片到 project/images/files/{asset_type}/，返回带类型前缀的相对路径。
    文件名基于 asset_id（平台资产 ID），同资产重复获取复用同一文件。
    local_path 格式 {asset_type}/{filename}，与系统图片路由（三段式）一致。
    """
    projects_dir = _get_projects_dir()
    images_files_dir = projects_dir / project_id / "images" / "files" / asset_type
    images_files_dir.mkdir(parents=True, exist_ok=True)

    # 用 asset_id（或 URL）的 SHA256 作为文件名
    name_key = asset_id or url
    url_hash = hashlib.sha256(name_key.encode()).hexdigest()[:16]
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

    return f"{asset_type}/{filename}"


def _guess_extension(url: str) -> str:
    """从 URL 猜测文件扩展名"""
    path = url.split("?")[0]
    _, ext = os.path.splitext(path)
    if ext.lower() in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return ext.lower()
    return ".jpg"
