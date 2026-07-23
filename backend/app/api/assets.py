from fastapi import APIRouter, HTTPException
from typing import List, Optional, Any
from pydantic import BaseModel, ConfigDict
import asyncio
import logging
import time

from app.services import AssetService
from app.services.asset_service import ImageService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{project_id}/assets", tags=["assets"])


class AssetCreate(BaseModel):
    """允许额外字段以支持不同资产类型的特有属性"""
    model_config = ConfigDict(extra='allow')

    asset_type: str  # "character", "scene", "prop", "episode"
    name: str
    description: str = ""
    metadata: dict = {}
    tags: List[str] = []


class EpisodeReorderRequest(BaseModel):
    episode_ids: List[str]


class AssetUpdate(BaseModel):
    """允许额外字段以支持不同资产类型的特有属性"""
    model_config = ConfigDict(extra='allow')

    name: str = None
    description: str = None
    metadata: dict = None
    tags: List[str] = None
    image_id: str = None
    image_prompt: str = None
    edit_image_prompt: str = None
    # Storyboard specific fields
    character_ids: List[str] = None
    scene_id: str = None
    prop_ids: List[str] = None
    camera_angle: str = None
    shot_type: str = None
    dialogue: str = None
    action: str = None


@router.post("", response_model=dict)
async def create_asset(project_id: str, asset: AssetCreate):
    """创建资产"""
    asset_data = asset.model_dump()
    result = await asyncio.to_thread(AssetService.save_asset, project_id, asset.asset_type, asset_data)
    return result


@router.get("/{asset_type}", response_model=List[dict])
async def list_assets(project_id: str, asset_type: str, include_children: bool = False):
    """列出资产（include_children=true时包含子资产，包含主图URL和图片数量）"""
    t0 = time.perf_counter()
    print(f"[REQ-IN] assets/{asset_type} project={project_id[:8]}")
    assets = await asyncio.to_thread(AssetService.list_assets, project_id, asset_type, include_children)
    t1 = time.perf_counter()

    asset_ids = [a["asset_id"] for a in assets]
    image_info = await asyncio.to_thread(ImageService.get_primary_images_with_count_batch, project_id, asset_ids)
    t2 = time.perf_counter()

    for asset in assets:
        info = image_info.get(asset["asset_id"], {})
        primary_image = info.get("primary_image")
        if primary_image:
            if primary_image.get("local_path"):
                asset["primary_image_url"] = f"/api/projects/{project_id}/images/files/{primary_image['local_path']}"
            else:
                asset["primary_image_url"] = primary_image.get("image_path")
            # 优先从 asset.image_id 对应的图片读取审核状态，避免与 is_primary 图片不一致
            asset_image_id = asset.get("image_id")
            ref_image = primary_image
            if asset_image_id:
                matched = next((img for img in info.get("images", []) if img.get("image_id") == asset_image_id), None)
                if matched:
                    ref_image = matched
            asset["volcengine_asset_id"] = ref_image.get("volcengine_asset_id")
            asset["volcengine_asset_status"] = ref_image.get("volcengine_asset_status")
        else:
            asset["primary_image_url"] = None
            asset["volcengine_asset_id"] = None
            asset["volcengine_asset_status"] = None
        asset["image_count"] = info.get("image_count", 0)

    print(
        f"[PERF] list_assets/{asset_type} | count={len(assets)} | "
        f"list={1000*(t1-t0):.1f}ms images={1000*(t2-t1):.1f}ms total={1000*(t2-t0):.1f}ms"
    )
    return assets


@router.get("/{asset_type}/{asset_id}", response_model=dict)
async def get_asset(project_id: str, asset_type: str, asset_id: str):
    """获取资产详情"""
    result = await asyncio.to_thread(AssetService.load_asset, project_id, asset_type, asset_id)
    if not result:
        raise HTTPException(status_code=404, detail="Asset not found")
    return result


@router.put("/{asset_type}/{asset_id}", response_model=dict)
async def update_asset(project_id: str, asset_type: str, asset_id: str, asset: AssetUpdate):
    """更新资产"""
    # 先加载现有资产
    current = await asyncio.to_thread(AssetService.load_asset, project_id, asset_type, asset_id)
    if not current:
        raise HTTPException(status_code=404, detail="Asset not found")

    # 打印调试信息
    logger.info(f"[DEBUG] Updating {asset_type}/{asset_id}")
    logger.info(f"[DEBUG] Received data: {asset.model_dump(exclude_unset=True)}")
    logger.info(f"[DEBUG] character_ids={asset.character_ids}, scene_id={asset.scene_id}, prop_ids={asset.prop_ids}")

    # 获取所有提交的字段（包括额外字段）
    update_data = asset.model_dump(exclude_unset=True)

    # 更新所有字段（包括额外字段如 gender, age, edit_image_prompt 等）
    for key, value in update_data.items():
        # image_id 单独处理，不直接更新到 current
        if key != "image_id":
            current[key] = value
            logger.info(f"[DEBUG] Updated {key} to: {value}")

    result = await asyncio.to_thread(AssetService.save_asset, project_id, asset_type, current)

    # 如果指定了image_id，更新主图
    if asset.image_id is not None:
        await asyncio.to_thread(AssetService.update_asset_image, project_id, asset_type, asset_id, asset.image_id)

    return result


@router.delete("/{asset_type}/{asset_id}")
async def delete_asset(project_id: str, asset_type: str, asset_id: str):
    """删除资产，并级联清理分镜中的引用"""
    success = await asyncio.to_thread(AssetService.delete_asset, project_id, asset_type, asset_id)
    if not success:
        raise HTTPException(status_code=404, detail="Asset not found")

    # 级联清理：从所有分镜中移除对该资产的引用
    if asset_type in ("character", "scene", "prop"):
        all_storyboards = await asyncio.to_thread(AssetService.list_assets, project_id, "storyboard")
        for sb in all_storyboards:
            changed = False
            if asset_type == "character" and asset_id in sb.get("character_ids", []):
                sb["character_ids"] = [x for x in sb["character_ids"] if x != asset_id]
                changed = True
            elif asset_type == "scene":
                if asset_id in sb.get("scene_ids", []):
                    sb["scene_ids"] = [x for x in sb["scene_ids"] if x != asset_id]
                    changed = True
                if sb.get("scene_id") == asset_id:
                    sb["scene_id"] = None
                    changed = True
            elif asset_type == "prop" and asset_id in sb.get("prop_ids", []):
                sb["prop_ids"] = [x for x in sb["prop_ids"] if x != asset_id]
                changed = True
            if changed:
                await asyncio.to_thread(AssetService.save_asset, project_id, "storyboard", sb)

    # 删除集后自动重排剩余集的 episode_number
    if asset_type == "episode":
        remaining = await asyncio.to_thread(AssetService.list_assets, project_id, "episode")
        remaining.sort(key=lambda e: e.get("episode_number", 0))
        for index, ep in enumerate(remaining):
            ep["episode_number"] = index + 1
            await asyncio.to_thread(AssetService.save_asset, project_id, "episode", ep)

    return {"success": True}


@router.post("/{asset_type}/{parent_id}/children", response_model=dict)
async def create_child_asset(project_id: str, asset_type: str, parent_id: str, asset: AssetCreate):
    """创建子资产（继承父资产的属性和图片）"""
    try:
        asset_data = asset.model_dump()
        result = await asyncio.to_thread(AssetService.create_child_asset, project_id, asset_type, parent_id, asset_data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/episode/reorder", response_model=dict)
async def reorder_episodes(project_id: str, body: EpisodeReorderRequest):
    """按传入顺序更新每集的 episode_number（从1开始）"""
    for index, episode_id in enumerate(body.episode_ids):
        episode = await asyncio.to_thread(AssetService.load_asset, project_id, "episode", episode_id)
        if not episode:
            raise HTTPException(status_code=404, detail=f"Episode {episode_id} not found")
        episode["episode_number"] = index + 1
        await asyncio.to_thread(AssetService.save_asset, project_id, "episode", episode)
    return {"success": True, "count": len(body.episode_ids)}


# Trigger reload for edit_image_prompt support
