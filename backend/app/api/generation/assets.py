"""
Volcengine Asset 管理 API 端点

提供将分镜图片提交到素材库的接口，
支持 CreateNow（Bearer 鉴权）和 Volcengine（AK/SK）双后端，
支持状态轮询，用于视频生成时使用 asset:// URI。
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import ImageService

logger = logging.getLogger(__name__)

router = APIRouter()


class SubmitAssetRequest(BaseModel):
    image_ids: list[str]


def _get_asset_service(project_id: str, project: dict):
    """根据项目视频配置实例化 AssetService"""
    from app.services.ai.asset import AssetService

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    if api_type == "createnow":
        from app.services.auth_service import get_auth_state
        from app.core.config import settings as _s
        auth = get_auth_state()
        return AssetService(
            api_type="createnow",
            api_url=_s.CREATENOW_BASE_URL,
            api_key=auth.get("api_key", ""),
            volcengine_ak=auth.get("volcengine_ak", ""),
            volcengine_sk=auth.get("volcengine_sk", ""),
            project_id=project_id,
        )
    else:
        return AssetService(
            api_type="volcengine",
            api_url="https://open.volcengineapi.com",
            api_key="",
            volcengine_ak=video_config.get("volcengine_ak", ""),
            volcengine_sk=video_config.get("volcengine_sk", ""),
            project_id=project_id,
        )


@router.post("/assets/submit")
async def submit_asset(project_id: str, request: SubmitAssetRequest):
    """批量将图片提交到素材库

    body: { image_ids: [str, ...] }
    返回: { submitted: [{image_id, asset_id, status}], skipped: [image_id, ...] }
    """
    from app.services import ProjectService
    from app.core.config import settings as _settings

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    svc = _get_asset_service(project_id, project)

    if api_type == "createnow":
        if not svc.api_key:
            raise HTTPException(status_code=400, detail="未配置 CreateNow API Key")

        from app.services.createnow_asset_service import read_image_as_base64_datauri

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
                asset_id = await svc.cn_submit_asset(image_datauri)
                image["volcengine_asset_id"] = asset_id
                image["volcengine_asset_status"] = "Processing"
                ImageService.save_generation_record(project_id, image)
                submitted.append({"image_id": image_id, "asset_id": asset_id, "status": "Processing"})
            except Exception as e:
                logger.error(f"[Asset] CreateNow 提交单张图片失败 {image_id}: {e}")
                skipped.append(image_id)
        return {"submitted": submitted, "skipped": skipped}

    # Volcengine 路径
    if not svc.volcengine_ak or not svc.volcengine_sk:
        raise HTTPException(status_code=400, detail="未配置 Volcengine AK/SK")

    try:
        group_id = await svc.vol_ensure_default_group(video_config)

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

            existing_asset_id = image.get("volcengine_asset_id")
            existing_status = image.get("volcengine_asset_status")
            if existing_asset_id and existing_status != "Failed":
                logger.info(f"[Asset] 已有 asset_id，跳过: {image_id} -> {existing_asset_id} ({existing_status})")
                skipped.append(image_id)
                continue

            image_path = image.get("image_path")
            if not image_path or not image_path.startswith(("http://", "https://")):
                logger.warning(f"[Asset] 无公网 URL，跳过: {image_id}")
                skipped.append(image_id)
                continue

            try:
                asset_id = await svc.vol_submit_asset(group_id, image_path)
                image["volcengine_asset_id"] = asset_id
                image["volcengine_asset_status"] = "Processing"
                ImageService.save_generation_record(project_id, image)
                submitted.append({"image_id": image_id, "asset_id": asset_id, "status": "Processing"})
            except Exception as e:
                logger.error(f"[Asset] Volcengine 提交单张图片失败 {image_id}: {e}")
                skipped.append(image_id)

        return {"submitted": submitted, "skipped": skipped}

    except Exception as e:
        logger.error(f"[Asset] 批量提交素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/assets/{asset_id}/status")
async def get_asset_status_endpoint(project_id: str, asset_id: str):
    """轮询素材状态，同步更新 image JSON

    返回: { status: str, image_id: str | None }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    svc = _get_asset_service(project_id, project)

    if api_type == "createnow":
        if not svc.api_key:
            raise HTTPException(status_code=400, detail="未配置 CreateNow API Key")
        try:
            result = await svc.cn_get_asset_status(asset_id)
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

    # Volcengine 路径
    if not svc.volcengine_ak or not svc.volcengine_sk:
        raise HTTPException(status_code=400, detail="未配置 Volcengine AK/SK")

    try:
        result = await svc.vol_get_asset_status(asset_id)
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
        logger.error(f"[Asset] 查询素材状态失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
