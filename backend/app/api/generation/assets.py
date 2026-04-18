"""
Volcengine Asset 管理 API 端点

提供将分镜图片提交到素材库的接口，
支持 CreateNow（Bearer 鉴权）和 Volcengine（AK/SK）双后端，
支持状态轮询，用于视频生成时使用 asset:// URI。
"""

import logging
import mimetypes
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import ImageService
from app.core.context import get_current_data_root

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class SubmitAssetRequest(BaseModel):
    image_ids: list[str] = []
    video_urls: list[str] = []
    project_name: str = "default"


def _get_asset_service(project_id: str, project: dict):
    """根据项目视频配置实例化 AssetService"""
    from app.services.ai.asset import AssetService

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    if api_type == "createnow":
        from app.core.config import settings as _s
        # 优先从项目配置读 api_key（SaaS 模式下 key 存在项目里）
        api_key = video_config.get("api_key", "")
        api_url = video_config.get("api_url", "") or _s.CREATENOW_BASE_URL
        # 回退到全局 auth_state（selfhosted 模式兼容）
        if not api_key:
            from app.services.auth_service import get_auth_state
            auth = get_auth_state()
            api_key = auth.get("api_key", "")
        return AssetService(
            api_type="createnow",
            api_url=api_url,
            api_key=api_key,
            volcengine_ak="",
            volcengine_sk="",
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


def _resolve_local_media_path(project_id: str, media_url: str):
    """将 /api/projects/{project_id}/generate/media/files/{filename} 解析为本地绝对路径"""
    if not media_url:
        return None, None, None

    parsed = urlparse(media_url)
    path = parsed.path or media_url
    marker = f"/api/projects/{project_id}/generate/media/files/"
    if marker not in path:
        return None, None, None

    filename = unquote(path.split(marker, 1)[1]).strip()
    if not filename or "/" in filename or "\\" in filename:
        return None, None, None

    media_dir = _get_projects_dir() / project_id / "generate" / "media"
    abs_path = (media_dir / filename).resolve()
    if abs_path.parent != media_dir.resolve():
        return None, None, None
    if not abs_path.exists() or not abs_path.is_file():
        return None, None, None

    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return str(abs_path), filename, content_type


def collect_submit_image_ids(project_id: str, episode_id: str = None) -> list[str]:
    """收集需要提交审核的所有图片 ID（分镜主图 + 关联角色/场景/道具图）。
    与前端"一键提交审核"按钮的收集逻辑保持一致。
    """
    from app.services.asset_service import AssetService

    storyboards = AssetService.list_assets(project_id, "storyboard") or []
    if episode_id:
        storyboards = [s for s in storyboards if s.get("episode_id") == episode_id]

    image_ids = []
    seen = set()

    def add(img_id):
        if img_id and img_id not in seen:
            image_ids.append(img_id)
            seen.add(img_id)

    for sb in storyboards:
        add(sb.get("image_id"))
        for char_id in sb.get("character_ids", []):
            char = AssetService.load_asset(project_id, "character", char_id)
            if char:
                add(char.get("image_id"))
        for scene_id in (sb.get("scene_ids") or ([sb["scene_id"]] if sb.get("scene_id") else [])):
            scene = AssetService.load_asset(project_id, "scene", scene_id)
            if scene:
                add(scene.get("image_id"))
        for prop_id in sb.get("prop_ids", []):
            prop = AssetService.load_asset(project_id, "prop", prop_id)
            if prop:
                add(prop.get("image_id"))

    return image_ids


async def submit_assets_core(project_id: str, image_ids: list[str]) -> dict:
    """可复用的提交审核核心逻辑，供 HTTP handler 和对话工具共同调用。
    返回 { submitted: [...], skipped: [...] }，失败时抛出异常。
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise ValueError("Project not found")

    req = SubmitAssetRequest(image_ids=image_ids, video_urls=[])
    # 复用 HTTP handler 的完整逻辑，通过内部调用
    return await _submit_asset_impl(project_id, project, req)


async def resubmit_assets_core(project_id: str, image_ids: list[str]) -> dict:
    """强制重新提交审核核心逻辑，忽略已有 asset_id 的守卫。"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise ValueError("Project not found")

    req = SubmitAssetRequest(image_ids=image_ids, video_urls=[])
    return await _submit_asset_impl(project_id, project, req, force=True)


async def _submit_asset_impl(project_id: str, project: dict, request: SubmitAssetRequest, force: bool = False) -> dict:
    """提交审核的实际实现，被 HTTP handler 和 submit_assets_core 共同调用。
    force=True 时忽略已有 asset_id 的守卫，清空旧状态后强制重新提交。
    """
    from app.services import ProjectService

    if not request.image_ids and not request.video_urls:
        raise ValueError("image_ids 和 video_urls 不能同时为空")

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    svc = _get_asset_service(project_id, project)

    if api_type == "createnow":
        if not svc.api_key:
            raise ValueError("未配置 CreateNow API Key")

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
            if existing_asset_id and existing_status != "Failed" and not force:
                skipped.append({
                    "ref_type": "image",
                    "image_id": image_id,
                    "asset_id": existing_asset_id,
                    "status": existing_status,
                })
                continue
            if force and existing_asset_id:
                image.pop("volcengine_asset_id", None)
                image.pop("volcengine_asset_status", None)
            local_path = image.get("local_path")
            if local_path:
                abs_path = str(_get_projects_dir() / project_id / "images" / "files" / local_path)
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
                submitted.append({
                    "ref_type": "image",
                    "image_id": image_id,
                    "asset_id": asset_id,
                    "status": "Processing",
                })
            except Exception as e:
                logger.error(f"[Asset] CreateNow 提交单张图片失败 {image_id}: {e}")
                skipped.append(image_id)

        for video_url in request.video_urls:
            abs_path, filename, content_type = _resolve_local_media_path(project_id, video_url)
            if not abs_path or not filename:
                logger.warning(f"[Asset] 无法解析本地视频路径，跳过: {video_url}")
                skipped.append({"ref_type": "video", "video_url": video_url})
                continue
            if not (content_type or "").startswith("video/"):
                logger.warning(f"[Asset] 非视频文件，跳过: {video_url}")
                skipped.append({"ref_type": "video", "video_url": video_url})
                continue
            try:
                with open(abs_path, "rb") as f:
                    file_bytes = f.read()
                asset_id = await svc.cn_submit_video(
                    file_bytes=file_bytes,
                    filename=filename,
                    content_type=content_type,
                    project_name=request.project_name,
                )
                submitted.append({
                    "ref_type": "video",
                    "video_url": video_url,
                    "asset_id": asset_id,
                    "status": "Processing",
                })
            except Exception as e:
                logger.error(f"[Asset] CreateNow 提交视频失败 {video_url}: {e}")
                skipped.append({"ref_type": "video", "video_url": video_url})

        return {"submitted": submitted, "skipped": skipped}

    # Volcengine 路径
    if not svc.volcengine_ak or not svc.volcengine_sk:
        raise ValueError("未配置 Volcengine AK/SK")

    group_id = await svc.vol_ensure_default_group(video_config)

    if video_config.get("volcengine_group_id"):
        full_ai_config = project.get("ai_config", {})
        full_ai_config["video"] = video_config
        ProjectService.update_project(project_id, ai_config=full_ai_config)

    submitted = []
    skipped = []
    for video_url in request.video_urls:
        skipped.append({"ref_type": "video", "video_url": video_url, "reason": "volcengine_not_supported"})

    for image_id in request.image_ids:
        image = ImageService.get_image(project_id, image_id)
        if not image:
            logger.warning(f"[Asset] 图片不存在，跳过: {image_id}")
            skipped.append(image_id)
            continue
        existing_asset_id = image.get("volcengine_asset_id")
        existing_status = image.get("volcengine_asset_status")
        if existing_asset_id and existing_status != "Failed" and not force:
            logger.info(f"[Asset] 已有 asset_id，跳过: {image_id} -> {existing_asset_id} ({existing_status})")
            skipped.append({"image_id": image_id, "asset_id": existing_asset_id, "status": existing_status})
            continue
        if force and existing_asset_id:
            image.pop("volcengine_asset_id", None)
            image.pop("volcengine_asset_status", None)
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


@router.post("/assets/submit")
async def submit_asset(project_id: str, request: SubmitAssetRequest):
    """批量将图片提交到素材库

    body: { image_ids: [str, ...] }
    返回: { submitted: [{image_id, asset_id, status}], skipped: [image_id, ...] }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        return await _submit_asset_impl(project_id, project, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Asset] 批量提交素材失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/assets/resubmit")
async def resubmit_asset(project_id: str, request: SubmitAssetRequest):
    """强制重新提交图片到素材库（忽略已有 asset_id，清空旧状态后重新提交）

    body: { image_ids: [str, ...] }
    返回: { submitted: [{image_id, asset_id, status}], skipped: [image_id, ...] }
    """
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        return await _submit_asset_impl(project_id, project, request, force=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Asset] 强制重新提交素材失败: {e}")
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
            ref_type = "video"
            all_images = ImageService.list_images(project_id)
            for img in all_images:
                if img.get("volcengine_asset_id") == asset_id:
                    image_id = img["image_id"]
                    ref_type = "image"
                    if img.get("volcengine_asset_status") != status:
                        img["volcengine_asset_status"] = status
                        ImageService.save_generation_record(project_id, img)
                    break
            return {
                "status": status,
                "asset_id": asset_id,
                "ref_type": ref_type,
                "image_id": image_id,
            }
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

        return {
            "status": status,
            "asset_id": asset_id,
            "ref_type": "image" if image_id else "video",
            "image_id": image_id,
        }

    except Exception as e:
        logger.error(f"[Asset] 查询素材状态失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
