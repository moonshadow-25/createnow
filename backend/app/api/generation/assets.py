"""
Volcengine Asset 管理 API 端点

提供将分镜图片提交到 Volcengine 素材库的接口，
支持状态轮询，用于视频生成时使用 asset:// URI。
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import ImageService
from app.services.volcengine_asset_service import (
    ensure_default_group, create_asset, get_asset_status, get_ak_sk
)

logger = logging.getLogger(__name__)

router = APIRouter()


class SubmitAssetRequest(BaseModel):
    image_ids: list[str]


@router.post("/assets/submit")
async def submit_asset(project_id: str, request: SubmitAssetRequest):
    """批量将图片提交到 Volcengine 素材库

    body: { image_ids: [str, ...] }
    返回: { submitted: [{image_id, asset_id, status}], skipped: [image_id, ...] }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    if api_type == "createnow":
        from app.services.createnow_asset_service import (
            get_api_key_and_url, read_image_as_base64_datauri, create_asset as cn_create_asset
        )
        api_key, api_url = get_api_key_and_url()
        if not api_key:
            raise HTTPException(status_code=400, detail="未配置 CreateNow API Key")

        from app.core.config import settings as _settings
        submitted = []
        skipped = []
        for image_id in request.image_ids:
            image = ImageService.get_image(project_id, image_id)
            if not image:
                skipped.append(image_id)
                continue
            existing_asset_id = image.get("volcengine_asset_id")
            existing_status = image.get("volcengine_asset_status")
            if existing_asset_id and existing_status != "Failed":
                skipped.append(image_id)
                continue
            # 优先用本地文件，降级到外部 URL
            local_path = image.get("local_path")
            if local_path:
                abs_path = str(_settings.PROJECTS_DIR / project_id / "images" / "files" / local_path)
            else:
                abs_path = image.get("image_path", "")
            if not abs_path:
                logger.warning(f"[Asset] 无图片路径，跳过: {image_id}")
                skipped.append(image_id)
                continue
            image_datauri = await read_image_as_base64_datauri(abs_path)
            if not image_datauri:
                logger.warning(f"[Asset] 无法读取图片，跳过: {image_id}")
                skipped.append(image_id)
                continue
            try:
                asset_id = await cn_create_asset(image_datauri, api_key, api_url)
                image["volcengine_asset_id"] = asset_id
                image["volcengine_asset_status"] = "Processing"
                ImageService.save_generation_record(project_id, image)
                submitted.append({"image_id": image_id, "asset_id": asset_id, "status": "Processing"})
            except Exception as e:
                logger.error(f"[Asset] CreateNow 提交单张图片失败 {image_id}: {e}")
                skipped.append(image_id)
        return {"submitted": submitted, "skipped": skipped}

    ak, sk = get_ak_sk(ai_config)
    if not ak or not sk:
        raise HTTPException(status_code=400, detail="未配置 Volcengine AK/SK")

    try:
        group_id = ensure_default_group(ak, sk, video_config)

        # 缓存 group_id 到项目配置
        if video_config.get("volcengine_group_id"):
            full_ai_config = project.get("ai_config", {})
            full_ai_config["video"] = video_config
            ProjectService.update_project(project_id, ai_config=full_ai_config)

        submitted = []
        skipped = []

        for image_id in request.image_ids:
            image = ImageService.get_image(project_id, image_id)
            if not image:
                logger.warning(f"[Asset] 图片不存在，跳过: {image_id}")
                skipped.append(image_id)
                continue

            # 已有有效 asset_id（非 Failed）则跳过，不重复提交
            existing_asset_id = image.get("volcengine_asset_id")
            existing_status = image.get("volcengine_asset_status")
            if existing_asset_id and existing_status != "Failed":
                logger.info(f"[Asset] 已有 asset_id，跳过: {image_id} -> {existing_asset_id} ({existing_status})")
                skipped.append(image_id)
                continue

            # 素材库只支持公网 URL
            image_path = image.get("image_path")
            if not image_path or not image_path.startswith(("http://", "https://")):
                logger.warning(f"[Asset] 无公网 URL，跳过: {image_id}")
                skipped.append(image_id)
                continue

            try:
                asset_id = create_asset(group_id, image_path, ak, sk)
                image["volcengine_asset_id"] = asset_id
                image["volcengine_asset_status"] = "Processing"
                ImageService.save_generation_record(project_id, image)
                submitted.append({"image_id": image_id, "asset_id": asset_id, "status": "Processing"})
            except Exception as e:
                logger.error(f"[Asset] 提交单张图片失败 {image_id}: {e}")
                skipped.append(image_id)

        return {"submitted": submitted, "skipped": skipped}

    except Exception as e:
        logger.error(f"[Asset] 批量提交素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/assets/{asset_id}/status")
async def get_asset_status_endpoint(project_id: str, asset_id: str):
    """轮询 Volcengine 素材状态，同步更新 image JSON

    返回: { status: str, image_id: str | None }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    if api_type == "createnow":
        from app.services.createnow_asset_service import (
            get_api_key_and_url, get_asset_status as cn_get_asset_status
        )
        api_key, api_url = get_api_key_and_url()
        if not api_key:
            raise HTTPException(status_code=400, detail="未配置 CreateNow API Key")
        try:
            result = await cn_get_asset_status(asset_id, api_key, api_url)
            status = result["status"]
            image_id = None
            all_images = ImageService.list_images(project_id)
            for img in all_images:
                if img.get("volcengine_asset_id") == asset_id:
                    image_id = img["image_id"]
                    if img.get("volcengine_asset_status") != status:
                        img["volcengine_asset_status"] = status
                        ImageService.save_generation_record(project_id, img)
                    break
            return {"status": status, "image_id": image_id}
        except Exception as e:
            logger.error(f"[Asset] CreateNow 查询素材状态失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    ak, sk = get_ak_sk(ai_config)
    if not ak or not sk:
        raise HTTPException(status_code=400, detail="未配置 Volcengine AK/SK")

    try:
        result = get_asset_status(asset_id, ak, sk)
        status = result["status"]

        # 找到对应的 image 记录并更新状态
        image_id = None
        all_images = ImageService.list_images(project_id)
        for img in all_images:
            if img.get("volcengine_asset_id") == asset_id:
                image_id = img["image_id"]
                if img.get("volcengine_asset_status") != status:
                    img["volcengine_asset_status"] = status
                    ImageService.save_generation_record(project_id, img)
                break

        return {"status": status, "image_id": image_id}

    except Exception as e:
        logger.error(f"[Asset] 查询素材状态失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
