"""
硅星人数字资产平台 API 路由

独立的 /platform/silicon 路由组，可随时移除。
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.silicon_platform_service import (
    SiliconPlatformError,
    SiliconPlatformService,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/platform/silicon",
    tags=["silicon-platform"],
)


# ═══════════════════════════════════════════════════════════════
# 请求模型
# ═══════════════════════════════════════════════════════════════

class AcquireTalentRequest(BaseModel):
    talent_id: int
    role_type: str  # "主角" / "配角" / "群演"
    character_id: str


class SaveCredentialsRequest(BaseModel):
    app_id: str
    app_secret: str


# ═══════════════════════════════════════════════════════════════
# 凭证管理
# ═══════════════════════════════════════════════════════════════

@router.get("/credentials")
async def get_credentials(project_id: str):
    """获取项目的硅星人平台凭证状态（不返回 secret）"""
    try:
        creds = SiliconPlatformService.get_credentials(project_id)
        return {"configured": creds is not None, "app_id": creds.get("app_id") if creds else None}
    except SiliconPlatformError as e:
        raise HTTPException(status_code=e.code or 400, detail=str(e))


@router.put("/credentials")
async def save_credentials(project_id: str, body: SaveCredentialsRequest):
    """保存项目的硅星人平台凭证"""
    if not body.app_id or not body.app_secret:
        raise HTTPException(status_code=400, detail="app_id 和 app_secret 不能为空")
    try:
        SiliconPlatformService.save_credentials(project_id, body.app_id, body.app_secret)
        return {"success": True, "app_id": body.app_id}
    except SiliconPlatformError as e:
        raise HTTPException(status_code=e.code or 400, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# 艺人查询（开放 API v1，需 HMAC 签名）
# ═══════════════════════════════════════════════════════════════

@router.get("/talents")
async def list_talents(
    project_id: str,
    keyword: Optional[str] = Query(None),
    ordering: str = Query("-total_revenue"),
    level: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """艺人列表（开放 API v1）"""
    try:
        return SiliconPlatformService.list_talents(
            project_id=project_id,
            keyword=keyword,
            ordering=ordering,
            level=level,
            page=page,
            page_size=page_size,
        )
    except SiliconPlatformError as e:
        raise HTTPException(status_code=e.code or 502, detail=str(e))


@router.get("/talents/{talent_id}")
async def get_talent(project_id: str, talent_id: int):
    """艺人详情（开放 API v1，含 main_image_url 主视图）"""
    try:
        return SiliconPlatformService.get_talent(project_id, talent_id)
    except SiliconPlatformError as e:
        raise HTTPException(status_code=e.code or 502, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# 付费获取（开放 API v1）
# ═══════════════════════════════════════════════════════════════

@router.post("/acquire-talent")
async def acquire_talent(project_id: str, body: AcquireTalentRequest):
    """按艺人批量付费获取全部三视图 + 下载 + 关联角色"""
    if body.role_type not in ("主角", "配角", "群演"):
        raise HTTPException(status_code=400, detail="role_type 必须为 主角/配角/群演")

    try:
        result = SiliconPlatformService.acquire_talent_and_download(
            project_id=project_id,
            talent_id=body.talent_id,
            role_type=body.role_type,
            character_id=body.character_id,
        )
        return result
    except SiliconPlatformError as e:
        # 余额不足 → 402 Payment Required
        if e.code == 1006:
            raise HTTPException(status_code=402, detail=str(e))
        # 资产/艺人不存在
        if e.code == 404:
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=e.code or 502, detail=str(e))
