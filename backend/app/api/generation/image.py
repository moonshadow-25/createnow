"""
Generation API - 图像生成相关端点
"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Body, UploadFile, File, Form, Request
from pydantic import BaseModel

from app.services import get_ai_service, PromptService, ImageService, AssetService
from app.core.config import settings
from app.core.context import get_current_data_root
from .models import (
    ImagePromptRequest,
    ImageGenerateRequest,
    ImageEditPromptRequest,
    ImageEditRequest,
    FusionPromptRequest,
    FusionImageRequest,
    VLMAnalyzeRequest,
)
from .utils import parse_size, check_project_budget, check_user_credit_limit, resolve_credits
from app.core.context import get_current_user
from .templates import DEFAULT_PROMPT_TEMPLATES
from .template_helpers import get_active_template
from app.models.project import normalize_global_style_config
from app.core.pricing import DEFAULT_IMAGE_COST

logger = logging.getLogger(__name__)

SQUARE_IMAGE_SCOPE = "square_generate"
CANVAS_GENERATE_SCOPE = "canvas_generate"
SQUARE_IMAGE_ASSET_TYPE = "generate"
SQUARE_IMAGE_ASSET_ID = "square-generate"
CANVAS_IMAGE_ASSET_TYPE = "generate"
CANVAS_IMAGE_ASSET_ID = "canvas-generate"


def _is_square_image_record(image: dict) -> bool:
    if image.get("generation_scope") == SQUARE_IMAGE_SCOPE:
        return True
    if image.get("generation_scope"):
        return False
    return image.get("asset_type") == SQUARE_IMAGE_ASSET_TYPE and image.get("asset_id") == SQUARE_IMAGE_ASSET_ID


def _is_virtual_image_asset(asset_type: str, asset_id: str) -> bool:
    return asset_type == SQUARE_IMAGE_ASSET_TYPE and asset_id in {SQUARE_IMAGE_ASSET_ID, CANVAS_IMAGE_ASSET_ID}


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


router = APIRouter()


class ImageBatchRequest(BaseModel):
    asset_ids: list[str]


def _resolve_generated_image_url(image_data: dict) -> str:
    """兼容url和b64_json两种返回格式"""
    image_url = image_data.get("url")
    if not image_url and image_data.get("b64_json"):
        image_url = f"data:image/png;base64,{image_data['b64_json']}"
    return image_url or ""


@router.post("/image-prompt")
async def generate_image_prompt(project_id: str, request: ImagePromptRequest):
    """生成图片提示词"""
    from app.services import ProjectService
    from .style_presets import get_image_style_suffix

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 获取项目的自定义提示词模板
    custom_templates = ai_config.get("prompt_templates", {})

    # 读取全局风格配置
    global_style_config = normalize_global_style_config(ai_config.get("global_style_config"))
    language = global_style_config.get("prompt_language", "zh")

    # 获取图片风格后缀
    image_style = global_style_config.get("image_style", {})
    style_suffix = ""
    if image_style.get("enabled", True):
        preset_id = image_style.get("preset_id", "none")
        if preset_id == "custom":
            style_suffix = image_style.get("custom_suffix", "")
        elif preset_id != "none":
            style_suffix = get_image_style_suffix(preset_id, language)

    # 记录请求日志
    template_used = "image_prompt_template"
    if request.asset_type == "storyboard":
        template_used = "storyboard_image_edit_prompt_template" if request.use_image_edit else "storyboard_image_prompt_template"

    request_log = {
        "asset_type": request.asset_type,
        "description": request.description[:500] + "..." if len(request.description) > 500 else request.description,
        "template_used": template_used,
    }

    try:
        if request.asset_type == "storyboard":
            # 分镜使用专门的分镜图片生成方法
            # 根据是否使用图生图编辑模式选择模板类型
            template_type = "storyboard_image_edit" if request.use_image_edit else "storyboard_image"

            # 使用辅助函数获取当前激活的模板
            custom_template = get_active_template(ai_config, template_type)

            request_log["shot_type"] = request.shot_type
            request_log["action"] = request.action
            request_log["camera_angle"] = request.camera_angle
            request_log["use_image_edit"] = request.use_image_edit
            request_log["template_type"] = template_type

            result = await PromptService.generate_storyboard_image_prompt(
                llm,
                request.description,
                shot_type=request.shot_type,
                action=request.action,
                camera_angle=request.camera_angle,
                custom_template=custom_template,
                language=language,
                style_suffix=style_suffix
            )
        else:
            # 其他资产类型使用通用图片生成方法
            custom_template = get_active_template(ai_config, "image")
            request_log["template_type"] = "image"

            result = await PromptService.generate_image_prompt(
                llm,
                request.asset_type,
                request.description,
                custom_template=custom_template,
                language=language,
                style_suffix=style_suffix
            )

        # 如果提供了 asset_id，自动保存生成的提示词
        if request.asset_id:
            generated_prompt = result.get("prompt") or result.get("positive_prompt", "")

            if generated_prompt:
                # 所有资产类型（包括分镜）统一使用 AssetService
                asset = AssetService.load_asset(project_id, request.asset_type, request.asset_id)
                if asset:
                    asset["image_prompt"] = generated_prompt
                    asset["updated_at"] = datetime.now().isoformat()
                    AssetService.save_asset(project_id, request.asset_type, asset)
                    logger.info(f"✅ 自动保存提示词到 {request.asset_type} {request.asset_id}")
                else:
                    logger.warning(f"⚠️ 资产不存在: {request.asset_type}/{request.asset_id}")

        await llm.close()
        return result

    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


async def generate_image_core(project_id: str, asset_id: str, asset_type: str, prompt: str,
                              negative_prompt: str = "", size: str = None, ai_config: dict = None,
                              generation_scope: str = None, model_override: str = None) -> dict:
    """可复用的生图核心逻辑（供 HTTP handler 和对话工具共同调用）

    返回第一张保存的图片记录 dict，失败时抛出异常。
    """
    from app.services import ProjectService

    if ai_config is None:
        project = ProjectService.get_project(project_id)
        if not project:
            raise ValueError("Project not found")
        ai_config = project.get("ai_config", {})
        check_project_budget(project)
        check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST)

    default_sizes = {"character": "16x9", "scene": "16x9", "prop": "1x1", "storyboard": "16x9"}
    configured_sizes = ai_config.get("image_sizes", {})
    size_str = size or configured_sizes.get(asset_type) or default_sizes.get(asset_type, "1x1")
    width, height = parse_size(size_str)

    image_service = get_ai_service(ai_config, "image", project_id)
    try:
        result = await image_service.generate(
            prompt=prompt, negative_prompt=negative_prompt,
            width=width, height=height, size_str=size_str,
            model=model_override
        )
        await image_service.close()
    except Exception:
        await image_service.close()
        raise

    if not result.get("success"):
        raise ValueError(result.get("error", "生图失败"))

    from app.services.image_download_service import ImageDownloadService

    images_data = result.get("images")
    if images_data:
        saved_images = []
        for i, img_data in enumerate(images_data):
            image_url = _resolve_generated_image_url(img_data)
            if not image_url:
                raise ValueError("生图返回结果缺少 url/b64_json")
            record = {
                "asset_id": asset_id, "asset_type": asset_type,
                "prompt": prompt, "negative_prompt": negative_prompt,
                "width": width, "height": height, "image_path": image_url,
                "model": model_override or ai_config.get("image", {}).get("model", "dall-e-3"),
                "actual_cost": resolve_credits(result, DEFAULT_IMAGE_COST), "credits_consumed": resolve_credits(result, DEFAULT_IMAGE_COST),
                "created_at": datetime.now().isoformat(),
                "created_by": get_current_user() or "",
                "generation_scope": generation_scope,
                "size": size_str,
                "reference_image_ids": [],
                "reference_image_urls": [],
            }
            saved = ImageService.save_generation_record(project_id, record)
            saved_images.append(saved)
            if i == 0:
                ImageService.set_primary_image(project_id, asset_id, saved["image_id"])
                if not _is_virtual_image_asset(asset_type, asset_id):
                    AssetService.update_asset_image(project_id, asset_type, asset_id, saved["image_id"])
            if image_url.startswith(("http://", "https://")):
                try:
                    await ImageDownloadService.download_and_save_image(
                        project_id=project_id, image_id=saved["image_id"],
                        url=image_url, asset_type=asset_type)
                except Exception as e:
                    logger.warning(f"自动下载图片失败 (image_id: {saved['image_id']}): {e}")
            elif image_url.startswith("data:image"):
                try:
                    ImageDownloadService.save_data_uri_image(
                        project_id=project_id,
                        image_id=saved["image_id"],
                        data_uri=image_url,
                        asset_type=asset_type,
                    )
                except Exception as e:
                    logger.warning(f"自动保存base64图片失败 (image_id: {saved['image_id']}): {e}")
            refreshed = ImageService.get_image(project_id, saved["image_id"])
            if refreshed:
                saved_images[-1] = refreshed
        logger.info(f"[多图生成] 成功生成并保存 {len(saved_images)} 张图片")
        return saved_images[0]
    else:
        image_url = result.get("image_url")
        record = {
            "asset_id": asset_id, "asset_type": asset_type,
            "prompt": prompt, "negative_prompt": negative_prompt,
            "width": width, "height": height, "image_path": image_url,
            "model": ai_config.get("image", {}).get("model", "dall-e-3"),
            "actual_cost": resolve_credits(result, DEFAULT_IMAGE_COST), "credits_consumed": resolve_credits(result, DEFAULT_IMAGE_COST),
            "created_at": datetime.now().isoformat(),
            "created_by": get_current_user() or "",
            "generation_scope": generation_scope,
            "size": size_str,
            "reference_image_ids": [],
            "reference_image_urls": [],
        }
        saved = ImageService.save_generation_record(project_id, record)
        images = ImageService.list_images(project_id, asset_id)
        if len(images) == 1:
            ImageService.set_primary_image(project_id, asset_id, saved["image_id"])
            if not _is_virtual_image_asset(asset_type, asset_id):
                AssetService.update_asset_image(project_id, asset_type, asset_id, saved["image_id"])
        if image_url and image_url.startswith(("http://", "https://")):
            try:
                await ImageDownloadService.download_and_save_image(
                    project_id=project_id, image_id=saved["image_id"],
                    url=image_url, asset_type=asset_type)
            except Exception as e:
                logger.warning(f"自动下载图片失败 (image_id: {saved['image_id']}): {e}")
        elif image_url and image_url.startswith("data:image"):
            try:
                ImageDownloadService.save_data_uri_image(
                    project_id=project_id,
                    image_id=saved["image_id"],
                    data_uri=image_url,
                    asset_type=asset_type,
                )
            except Exception as e:
                logger.warning(f"自动保存base64图片失败 (image_id: {saved['image_id']}): {e}")
        refreshed = ImageService.get_image(project_id, saved["image_id"])
        return refreshed or saved


@router.post("/image")
async def generate_image(project_id: str, request: ImageGenerateRequest):
    """生成图片"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    check_project_budget(project)
    check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST)
    ai_config = project.get("ai_config", {})

    try:
        saved = await generate_image_core(
            project_id=project_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            size=request.size,
            ai_config=ai_config,
            generation_scope=request.generation_scope,
            model_override=request.model,
        )
        return saved
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/image-edit-prompt")
async def generate_image_edit_prompt(project_id: str, request: ImageEditPromptRequest):
    """生成图像编辑提示词（用于子角色基于父角色形象生成图片）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 加载父角色和子角色
    parent_character = AssetService.load_asset(project_id, "character", request.parent_asset_id)
    child_character = AssetService.load_asset(project_id, "character", request.child_asset_id)

    if not parent_character:
        raise HTTPException(status_code=404, detail="Parent character not found")
    if not child_character:
        raise HTTPException(status_code=404, detail="Child character not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 获取项目的自定义提示词模板
    custom_templates = ai_config.get("prompt_templates", {})
    custom_template = custom_templates.get("image_edit_prompt_template")

    try:
        prompt = await PromptService.generate_image_edit_prompt(
            llm,
            parent_character,
            child_character,
            custom_template=custom_template
        )
        await llm.close()
        return {"prompt": prompt}

    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


async def edit_image_core(project_id: str, asset_id: str, asset_type: str, prompt: str,
                          reference_image_paths: list, size: str = None, ai_config: dict = None,
                          generation_scope: str = None,
                          reference_image_ids: list = None,
                          reference_image_urls: list = None,
                          model_override: str = None) -> dict:
    """可复用的图生图核心逻辑（供 HTTP handler 和对话工具共同调用）

    reference_image_paths: 已解析好的图片路径列表（base64 data URL 或 http URL）
    返回第一张保存的图片记录 dict，失败时抛出异常。
    """
    from app.services import ProjectService

    if ai_config is None:
        project = ProjectService.get_project(project_id)
        if not project:
            raise ValueError("Project not found")
        ai_config = project.get("ai_config", {})
        check_project_budget(project)
        check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST)

    if not reference_image_paths:
        raise ValueError("至少需要一张参考图片")

    default_sizes = {"character": "16x9", "scene": "16x9", "prop": "1x1", "storyboard": "16x9"}
    configured_sizes = ai_config.get("image_sizes", {})
    size_str = size or configured_sizes.get(asset_type) or default_sizes.get(asset_type, "1x1")
    width, height = parse_size(size_str)

    image_config = ai_config.get("image", {})
    model = model_override or image_config.get("image_edit_model") or image_config.get("model", "")

    image_service = get_ai_service(ai_config, "image", project_id)
    try:
        result = await image_service.edit(
            image_path=reference_image_paths[0],
            prompt=prompt,
            size=size_str,
            width=width,
            height=height,
            model=model,
            reference_images=reference_image_paths[1:] or None
        )
        await image_service.close()
    except Exception:
        await image_service.close()
        raise

    if not result.get("success"):
        raise ValueError(result.get("error", "图生图失败"))

    from app.services.image_download_service import ImageDownloadService

    images_data = result.get("images")
    if images_data:
        saved_images = []
        for i, img_data in enumerate(images_data):
            image_url = _resolve_generated_image_url(img_data)
            if not image_url:
                raise ValueError("图生图返回结果缺少 url/b64_json")
            record = {
                "asset_id": asset_id, "asset_type": asset_type,
                "prompt": prompt, "negative_prompt": "",
                "width": width, "height": height, "image_path": image_url,
                "model": model, "actual_cost": resolve_credits(result, DEFAULT_IMAGE_COST), "credits_consumed": resolve_credits(result, DEFAULT_IMAGE_COST),
                "created_at": datetime.now().isoformat(),
                "created_by": get_current_user() or "",
                "generation_scope": generation_scope,
                "size": size_str,
                "reference_image_ids": reference_image_ids or [],
                "reference_image_urls": reference_image_urls or [],
            }
            saved = ImageService.save_generation_record(project_id, record)
            saved_images.append(saved)
            if i == 0:
                ImageService.set_primary_image(project_id, asset_id, saved["image_id"])
                if not _is_virtual_image_asset(asset_type, asset_id):
                    AssetService.update_asset_image(project_id, asset_type, asset_id, saved["image_id"])
            if image_url.startswith(("http://", "https://")):
                try:
                    await ImageDownloadService.download_and_save_image(
                        project_id=project_id, image_id=saved["image_id"],
                        url=image_url, asset_type=asset_type)
                except Exception as e:
                    logger.warning(f"自动下载图片失败 (image_id: {saved['image_id']}): {e}")
            elif image_url.startswith("data:image"):
                try:
                    ImageDownloadService.save_data_uri_image(
                        project_id=project_id,
                        image_id=saved["image_id"],
                        data_uri=image_url,
                        asset_type=asset_type,
                    )
                except Exception as e:
                    logger.warning(f"自动保存base64图片失败 (image_id: {saved['image_id']}): {e}")
            refreshed = ImageService.get_image(project_id, saved["image_id"])
            if refreshed:
                saved_images[-1] = refreshed
        logger.info(f"[图生图] 成功生成并保存 {len(saved_images)} 张图片")
        return saved_images[0]
    else:
        image_url = result.get("image_url")
        record = {
            "asset_id": asset_id, "asset_type": asset_type,
            "prompt": prompt, "negative_prompt": "",
            "width": width, "height": height, "image_path": image_url,
            "model": model, "actual_cost": resolve_credits(result, DEFAULT_IMAGE_COST), "credits_consumed": resolve_credits(result, DEFAULT_IMAGE_COST),
            "created_at": datetime.now().isoformat(),
            "created_by": get_current_user() or "",
            "generation_scope": generation_scope,
            "size": size_str,
            "reference_image_ids": reference_image_ids or [],
            "reference_image_urls": reference_image_urls or [],
        }
        saved = ImageService.save_generation_record(project_id, record)
        images = ImageService.list_images(project_id, asset_id)
        if len(images) == 1:
            ImageService.set_primary_image(project_id, asset_id, saved["image_id"])
            if not _is_virtual_image_asset(asset_type, asset_id):
                AssetService.update_asset_image(project_id, asset_type, asset_id, saved["image_id"])
        if image_url and image_url.startswith(("http://", "https://")):
            try:
                await ImageDownloadService.download_and_save_image(
                    project_id=project_id, image_id=saved["image_id"],
                    url=image_url, asset_type=asset_type)
            except Exception as e:
                logger.warning(f"自动下载图片失败 (image_id: {saved['image_id']}): {e}")
        elif image_url and image_url.startswith("data:image"):
            try:
                ImageDownloadService.save_data_uri_image(
                    project_id=project_id,
                    image_id=saved["image_id"],
                    data_uri=image_url,
                    asset_type=asset_type,
                )
            except Exception as e:
                logger.warning(f"自动保存base64图片失败 (image_id: {saved['image_id']}): {e}")
        refreshed = ImageService.get_image(project_id, saved["image_id"])
        return refreshed or saved


@router.post("/image-edit")
async def edit_image(project_id: str, request: ImageEditRequest):
    """图像编辑（基于参考图生成新图）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 验证资产存在
    if not _is_virtual_image_asset(request.asset_type, request.asset_id):
        asset = AssetService.load_asset(project_id, request.asset_type, request.asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")

    ai_config = project.get("ai_config", {})

    # 检查项目预算
    check_project_budget(project)
    check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST)

    # 【模板支持】如果指定了模板，使用用户当前激活的模板内容作为提示词
    if request.template:
        from .template_helpers import get_active_template
        template_content = get_active_template(ai_config, request.template)
        if template_content:
            request.prompt = template_content
            logger.info(f"[图生图] 使用模板: {request.template}")
        else:
            logger.warning(f"[图生图] 模板不存在: {request.template}，使用原始提示词")

    # 收集所有参考图片路径（智能判断：优先本地base64，降级URL）
    reference_image_paths = []

    # 处理 reference_image_ids：从已保存的图片中提取
    for ref_image_id in request.reference_image_ids:
        ref_image = ImageService.get_image(project_id, ref_image_id)
        if not ref_image:
            raise HTTPException(status_code=404, detail=f"Reference image not found: {ref_image_id}")

        # 优先使用本地文件（转base64）
        local_path = ref_image.get("local_path")
        if local_path:
            project_dir = _get_projects_dir() / project_id
            local_file_path = project_dir / "images" / "files" / local_path

            if local_file_path.exists():
                try:
                    from app.services.image_download_service import ImageDownloadService
                    base64_url = ImageDownloadService.image_to_base64_url(local_file_path)
                    reference_image_paths.append(base64_url)
                    logger.info(f"[图生图] 使用本地图片 (base64): {local_path}")
                    continue
                except Exception as e:
                    logger.warning(f"[图生图] 读取本地图片失败 {local_path}: {e}，尝试使用URL")

        # 降级到外部URL
        image_path = ref_image.get("image_path")
        if image_path and image_path.startswith(("http://", "https://")):
            reference_image_paths.append(image_path)
            logger.info(f"[图生图] 使用外部URL: {image_path[:100]}")
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Image {ref_image_id}: 本地文件不存在且无有效URL"
            )

    # 处理 reference_image_urls：手动输入的URL直接使用
    logger.info(f"[图生图] 收到 reference_image_urls: {request.reference_image_urls}")
    for url in request.reference_image_urls:
        url = url.strip()
        logger.info(f"[图生图] 处理URL: {url[:100] if url else 'empty'}, startswith http: {url.startswith(('http://', 'https://')) if url else False}, startswith data: {url.startswith('data:image') if url else False}")
        if url and url.startswith(("http://", "https://", "data:image")):
            reference_image_paths.append(url)
            logger.info(f"[图生图] ✓ 接受URL: {url[:100]}")
        else:
            logger.warning(f"[图生图] ✗ 拒绝URL: {url[:100] if url else 'empty'}")

    logger.info(f"[图生图] 最终 reference_image_paths 数量: {len(reference_image_paths)}")

    if not reference_image_paths:
        logger.error(f"[图生图] 验证失败 - reference_image_ids: {request.reference_image_ids}, reference_image_urls: {request.reference_image_urls}")
        raise HTTPException(status_code=400, detail="At least one reference image is required")

    try:
        saved = await edit_image_core(
            project_id=project_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
            prompt=request.prompt,
            reference_image_paths=reference_image_paths,
            size=request.size,
            ai_config=ai_config,
            generation_scope=request.generation_scope or (SQUARE_IMAGE_SCOPE if _is_virtual_image_asset(request.asset_type, request.asset_id) else None),
            reference_image_ids=request.reference_image_ids,
            reference_image_urls=request.reference_image_urls,
            model_override=request.model,
        )
        return saved
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fusion-prompt")
async def generate_fusion_prompt(project_id: str, request: FusionPromptRequest):
    """生成融合图片提示词"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 验证资产数量
    if len(request.asset_ids) != len(request.asset_types):
        raise HTTPException(status_code=400, detail="asset_ids and asset_types length mismatch")

    if len(request.asset_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 assets required for fusion")

    # 加载所有源资产信息
    assets_info = []
    for asset_id, asset_type in zip(request.asset_ids, request.asset_types):
        asset = AssetService.load_asset(project_id, asset_type, asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail=f"Asset not found: {asset_id}")
        assets_info.append({
            "type": asset_type,
            "name": asset.get("name", ""),
            "description": asset.get("description", ""),
        })

    # 构建提示词生成请求
    assets_desc = "\n".join([
        f"- {info['type']}: {info['name']} - {info['description']}"
        for info in assets_info
    ])

    # 模板在 data/config/default_prompt_templates.json 中修改，支持项目级覆盖
    from app.services.global_prompt_service import get_prompt_content
    _fusion_tpl = get_prompt_content("fusion_image_prompt", ai_config)
    if _fusion_tpl:
        prompt_template = _fusion_tpl.format(assets_desc=assets_desc, user_prompt=request.user_prompt)
    else:
        prompt_template = f"""请根据以下资产信息和用户需求，生成一个融合图片的详细提示词。

源资产信息：
{assets_desc}

用户需求：{request.user_prompt}

请生成一个详细的图片生成提示词，要求：
1. 融合所有源资产的特征
2. 符合用户的需求描述
3. 提示词要具体、详细、适合图片生成
4. 直接输出提示词，不要其他解释"""

    ai_config = project.get("ai_config", {})
    llm_service = get_ai_service(ai_config, "llm", project_id)

    try:
        response = await llm_service.chat([
            {"role": "user", "content": prompt_template}
        ])

        generated_prompt = response.get("content", "").strip()

        await llm_service.close()
        return {"prompt": generated_prompt}

    except Exception as e:
        await llm_service.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fusion-image")
async def generate_fusion_image(project_id: str, request: FusionImageRequest):
    """生成融合图片（图生图）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 验证参数
    if len(request.asset_ids) != len(request.asset_types):
        raise HTTPException(status_code=400, detail="asset_ids and asset_types length mismatch")

    if len(request.image_ids) < 1:
        raise HTTPException(status_code=400, detail="At least 1 image required for fusion")

    # 收集所有参考图片路径
    reference_image_paths = []
    for image_id in request.image_ids:
        ref_image = ImageService.get_image(project_id, image_id)
        if not ref_image:
            raise HTTPException(status_code=404, detail=f"Image not found: {image_id}")

        # 优先使用本地文件（转base64）
        local_path = ref_image.get("local_path")
        if local_path:
            project_dir = _get_projects_dir() / project_id
            local_file_path = project_dir / "images" / "files" / local_path

            if local_file_path.exists():
                try:
                    from app.services.image_download_service import ImageDownloadService
                    base64_url = ImageDownloadService.image_to_base64_url(local_file_path)
                    reference_image_paths.append(base64_url)
                    logger.info(f"[融合生图] 使用本地图片 (base64): {local_path}")
                    continue
                except Exception as e:
                    logger.warning(f"[融合生图] 读取本地图片失败 {local_path}: {e}，尝试使用URL")

        # 降级到外部URL
        image_path = ref_image.get("image_path")
        if image_path and image_path.startswith(("http://", "https://")):
            reference_image_paths.append(image_path)
            logger.info(f"[融合生图] 使用外部URL: {image_path[:100]}")
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Image {image_id}: 本地文件不存在且无有效URL"
            )

    if not reference_image_paths:
        raise HTTPException(status_code=400, detail="No valid reference images found")

    ai_config = project.get("ai_config", {})

    # 检查项目预算
    check_project_budget(project)
    check_user_credit_limit(get_current_user(), DEFAULT_IMAGE_COST)

    # 获取配置的分辨率
    size_str = request.size or "1x1"
    width, height = parse_size(size_str)
    size_for_api = f"{width}x{height}"

    image_service = get_ai_service(ai_config, "image", project_id)

    request_log = {
        "asset_ids": request.asset_ids,
        "asset_types": request.asset_types,
        "image_ids": request.image_ids,
        "prompt": request.prompt[:500] + "..." if len(request.prompt) > 500 else request.prompt,
        "size_config": size_str,
        "size_api": size_for_api,
    }

    try:
        image_config = ai_config.get("image", {})
        model = image_config.get("image_edit_model") or image_config.get("model", "wan2.6-image")

        primary_image = reference_image_paths[0]
        extra_images = reference_image_paths[1:] if len(reference_image_paths) > 1 else None

        logger.info(f"[融合生图] 开始生成，使用 {len(reference_image_paths)} 张参考图")

        result = await image_service.edit(
            image_path=primary_image,
            prompt=request.prompt,
            reference_images=extra_images,
            model=model,
            size=size_for_api
        )

        await image_service.close()

        image_url = result.get("image_url")

        # 如果提供了canvas_element_id，保存图片记录并关联
        if request.canvas_element_id:
            # 保存生成记录
            record = {
                "asset_id": request.canvas_element_id,
                "asset_type": "canvas_element",
                "prompt": request.prompt,
                "negative_prompt": "",
                "width": width,
                "height": height,
                "image_path": image_url,
                "model": model,
                "actual_cost": resolve_credits(result, DEFAULT_IMAGE_COST), "credits_consumed": resolve_credits(result, DEFAULT_IMAGE_COST),
                "created_at": datetime.now().isoformat(),
                "created_by": get_current_user() or "",
            }

            saved = ImageService.save_generation_record(project_id, record)

            # 设置为主图
            ImageService.set_primary_image(project_id, request.canvas_element_id, saved["image_id"])
            AssetService.update_asset_image(
                project_id, "canvas_element", request.canvas_element_id, saved["image_id"]
            )

            # 自动下载图片到本地
            from app.services.image_download_service import ImageDownloadService
            if image_url and image_url.startswith(("http://", "https://")):
                try:
                    await ImageDownloadService.download_and_save_image(
                        project_id=project_id,
                        image_id=saved["image_id"],
                        url=image_url,
                        asset_type="canvas_element"
                    )
                except Exception as e:
                    logger.warning(f"自动下载融合图片失败 (image_id: {saved['image_id']}): {e}")

        return {
            "image_url": image_url,
            "revised_prompt": result.get("revised_prompt"),
        }
    except HTTPException:
        raise
    except Exception as e:
        await image_service.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/images/library")
async def list_library_images(project_id: str, mine: bool = False):
    """列出广场生图历史"""
    images = [img for img in ImageService.list_images(project_id) if _is_square_image_record(img)]
    if mine:
        current_user = get_current_user() or ""
        images = [img for img in images if (img.get("created_by") or "") == current_user]
    images.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return images


@router.post("/images/batch")
async def list_images_batch(project_id: str, request: ImageBatchRequest):
    """批量列出多个资产的图片记录"""
    asset_ids = {asset_id for asset_id in request.asset_ids if asset_id}
    if not asset_ids:
        return {"images": []}
    images = [img for img in ImageService.list_images(project_id) if img.get("asset_id") in asset_ids]
    images.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"images": images}


@router.get("/images/{asset_id}")
async def list_asset_images(project_id: str, asset_id: str):
    """列出资产的所有图片"""
    return ImageService.list_images(project_id, asset_id)


@router.post("/images/upload")
async def upload_image(
    request: Request,
    project_id: str,
    asset_id: str = Form(...),
    asset_type: str = Form(...),
    prompt: str = Form("手动上传"),
    file: UploadFile = File(...)
):
    """上传图片到资产或分镜"""
    try:
        # 验证文件类型
        allowed_types = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file.content_type}，仅支持 JPG、PNG、WEBP 格式")

        # 生成唯一文件名
        ext = file.filename.split('.')[-1] if file.filename and '.' in file.filename else 'png'
        filename = f"{uuid.uuid4()}.{ext}"

        # 保存文件
        project_dir = _get_projects_dir() / project_id
        files_dir = project_dir / "images" / "files" / asset_type
        files_dir.mkdir(parents=True, exist_ok=True)

        file_path = files_dir / filename
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        # 创建图片记录
        record = {
            "image_id": str(uuid.uuid4()),
            "asset_id": asset_id,
            "asset_type": asset_type,
            "prompt": prompt,
            "negative_prompt": "",
            "model": "manual_upload",
            "actual_cost": 0,
            "width": 0,
            "height": 0,
            "image_path": str(request.base_url).rstrip("/") + f"/api/projects/{project_id}/images/files/{asset_type}/{filename}",
            "created_by": get_current_user() or "",
            "local_path": f"{asset_type}/{filename}",
            "created_at": datetime.now().isoformat(),
            "is_primary": False
        }

        # 保存记录
        saved_record = ImageService.save_generation_record(project_id, record)

        # 如果是该资产的第一张图片，自动设为主图
        existing_images = ImageService.list_images(project_id, asset_id)
        if len(existing_images) == 1:
            ImageService.set_primary_image(project_id, asset_id, saved_record["image_id"])
            saved_record["is_primary"] = True
            # 同步更新资产的 image_id 字段
            AssetService.update_asset_image(project_id, asset_type, asset_id, saved_record["image_id"])

        logger.info(f"Image uploaded successfully: {filename} for asset {asset_id}")
        return saved_record

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading image: {e}")
        raise HTTPException(status_code=500, detail=f"上传图片失败: {str(e)}")


@router.post("/images/{image_id}/set-primary")
async def set_primary_image(project_id: str, image_id: str, asset_id: str = Body(..., embed=True)):
    """设置主图"""
    success = ImageService.set_primary_image(project_id, asset_id, image_id)
    if not success:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"success": True}


@router.post("/images/split-triple")
async def split_triple_grid_image(project_id: str, storyboard_id: str = Body(..., embed=True)):
    """
    拆解三宫格图片：将分镜主图按上中下三等分，创建3个新分镜

    - 获取原分镜及其主图
    - 将图片分割成3份
    - 创建3个新分镜（继承原分镜信息）
    - 新分镜插入到原分镜之后，后续分镜序号+3
    """
    from app.services import ProjectService
    from app.services.image_split_service import ImageSplitService

    # 验证项目
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 获取原分镜
    storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
    if not storyboard:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    # 获取主图
    primary_image = ImageService.get_primary_image(project_id, storyboard_id)
    if not primary_image:
        raise HTTPException(status_code=400, detail="分镜没有主图，无法拆解")

    # 获取图片文件路径
    local_path = primary_image.get("local_path")
    if not local_path:
        raise HTTPException(status_code=400, detail="主图没有本地文件，请先下载图片")

    project_dir = _get_projects_dir() / project_id
    image_file_path = project_dir / "images" / "files" / local_path

    if not image_file_path.exists():
        raise HTTPException(status_code=400, detail="主图文件不存在")

    # 分割图片
    output_dir = project_dir / "images" / "files" / "storyboard"
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        split_paths = ImageSplitService.split_image_triple(image_file_path, output_dir)
    except Exception as e:
        logger.error(f"分割图片失败: {e}")
        raise HTTPException(status_code=500, detail=f"分割图片失败: {str(e)}")

    # 获取原分镜信息
    original_sequence = storyboard.get("sequence", 1)
    episode_id = storyboard.get("episode_id")

    # 将后续分镜序号 +3
    all_storyboards = AssetService.list_assets(project_id, "storyboard")
    for sb in all_storyboards:
        if sb.get("episode_id") == episode_id and sb.get("sequence", 0) > original_sequence:
            sb["sequence"] = sb["sequence"] + 3
            AssetService.save_asset(project_id, "storyboard", sb)

    # 创建3个新分镜
    new_storyboards = []
    position_names = ["上", "中", "下"]

    for i, split_path in enumerate(split_paths):
        # 创建图片记录
        relative_path = f"storyboard/{split_path.name}"
        image_record = {
            "image_id": str(uuid.uuid4()),
            "asset_id": None,  # 稍后更新
            "asset_type": "storyboard",
            "prompt": f"从三宫格拆解（{position_names[i]}）",
            "negative_prompt": "",
            "model": "split",
            "actual_cost": 0,
            "width": 0,
            "height": 0,
            "image_path": None,
            "local_path": relative_path,
            "created_at": datetime.now().isoformat(),
            "is_primary": True
        }

        # 创建新分镜（继承原分镜信息）
        new_storyboard = {
            "episode_id": episode_id,
            "sequence": original_sequence + i + 1,
            "description": f"{storyboard.get('description', '')}（{position_names[i]}）",
            "character_ids": storyboard.get("character_ids", []),
            "scene_id": storyboard.get("scene_id"),
            "prop_ids": storyboard.get("prop_ids", []),
            "camera_angle": storyboard.get("camera_angle"),
            "shot_type": storyboard.get("shot_type"),
            "dialogue": storyboard.get("dialogue", ""),
            "action": storyboard.get("action", ""),
            "image_prompt": storyboard.get("image_prompt"),
        }

        # 保存新分镜
        saved_storyboard = AssetService.save_asset(project_id, "storyboard", new_storyboard)
        new_storyboard_id = saved_storyboard["asset_id"]

        # 更新图片记录的 asset_id 并保存
        image_record["asset_id"] = new_storyboard_id
        saved_image = ImageService.save_generation_record(project_id, image_record)

        # 更新分镜的 image_id
        saved_storyboard["image_id"] = saved_image["image_id"]
        AssetService.save_asset(project_id, "storyboard", saved_storyboard)

        new_storyboards.append(saved_storyboard)

    logger.info(f"成功拆解三宫格，创建了 {len(new_storyboards)} 个新分镜")

    return {
        "success": True,
        "message": f"成功拆解为3个分镜（第{original_sequence + 1}-{original_sequence + 3}镜）",
        "new_storyboards": new_storyboards
    }


@router.post("/vlm-analyze")
async def vlm_analyze(project_id: str, request: VLMAnalyzeRequest):
    """使用VLM分析图片（统一接口）

    Args:
        project_id: 项目ID
        request: VLM分析请求
            - image_ids: 图片ID列表
            - user_goal: 用户目标（会填充到VLM模板的{user_goal}占位符中）

    Returns:
        {"prompt": "VLM分析结果"}
    """
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not request.image_ids:
        raise HTTPException(status_code=400, detail="至少需要提供一张图片")

    if len(request.image_ids) > 4:
        raise HTTPException(status_code=400, detail="最多支持4张图片")

    ai_config = project.get("ai_config", {})

    # 检查VLM配置，如果没有则回退到LLM
    vlm_config = ai_config.get("vlm", {})
    if vlm_config.get("api_url") and vlm_config.get("api_key"):
        vlm = get_ai_service(ai_config, "vlm", project_id)
    else:
        # 回退到LLM配置
        vlm = get_ai_service(ai_config, "llm", project_id)
        logger.warning(f"[VLM分析] VLM未配置，回退使用LLM")

    try:
        # 1. 获取所有图片并转为base64
        image_base64_list = []
        for img_id in request.image_ids:
            img = ImageService.get_image(project_id, img_id)
            if not img:
                raise HTTPException(status_code=404, detail=f"图片不存在: {img_id}")

            # 优先使用本地文件
            local_path = img.get("local_path")
            if local_path:
                project_dir = _get_projects_dir() / project_id
                local_file_path = project_dir / "images" / "files" / local_path

                if local_file_path.exists():
                    try:
                        base64_url = ImageDownloadService.image_to_base64_url(local_file_path)
                        image_base64_list.append(base64_url)
                        logger.info(f"[VLM分析] 使用本地图片: {local_path}")
                        continue
                    except Exception as e:
                        logger.warning(f"[VLM分析] 读取本地图片失败 {local_path}: {e}")

            # 降级到外部URL（需要先下载再转base64）
            image_path = img.get("image_path")
            if image_path and image_path.startswith(("http://", "https://")):
                try:
                    # 下载图片并转base64
                    import aiohttp
                    async with aiohttp.ClientSession() as session:
                        async with session.get(image_path, ssl=False) as resp:
                            if resp.status == 200:
                                import base64
                                img_data = await resp.read()
                                img_base64 = base64.b64encode(img_data).decode()
                                # 检测content-type
                                content_type = resp.headers.get('content-type', 'image/jpeg')
                                base64_url = f"data:{content_type};base64,{img_base64}"
                                image_base64_list.append(base64_url)
                                logger.info(f"[VLM分析] 使用外部URL: {image_path[:100]}")
                                continue
                except Exception as e:
                    logger.error(f"[VLM分析] 下载外部图片失败 {image_path}: {e}")
                    raise HTTPException(status_code=500, detail=f"无法获取图片: {img_id}")

            raise HTTPException(status_code=404, detail=f"图片 {img_id} 无可用路径")

        # 2. 获取VLM模板并填充占位符
        custom_templates = ai_config.get("prompt_templates", {})
        vlm_template = custom_templates.get("vlm_prompt_template")

        if not vlm_template:
            # 使用默认模板
            from .templates import DEFAULT_PROMPT_TEMPLATES
            vlm_template = DEFAULT_PROMPT_TEMPLATES.get("vlm_prompt_template", "")

        # 格式化分镜信息
        storyboard_info_text = ""
        if request.descriptions or request.shot_types or request.camera_angles or request.actions or request.dialogues:
            for i in range(len(request.image_ids)):
                info = f"分镜 {i+1}:\n"
                if i < len(request.descriptions) and request.descriptions[i]:
                    info += f"  描述: {request.descriptions[i]}\n"
                if i < len(request.shot_types) and request.shot_types[i]:
                    info += f"  镜头类型: {request.shot_types[i]}\n"
                if i < len(request.camera_angles) and request.camera_angles[i]:
                    info += f"  镜头角度: {request.camera_angles[i]}\n"
                if i < len(request.actions) and request.actions[i]:
                    info += f"  动作: {request.actions[i]}\n"
                if i < len(request.dialogues) and request.dialogues[i]:
                    info += f"  对话: {request.dialogues[i]}\n"
                storyboard_info_text += info + "\n"
        else:
            storyboard_info_text = "（无额外文字信息）"

        # 填充占位符
        system_prompt = vlm_template.replace("{user_goal}", request.user_goal)
        system_prompt = system_prompt.replace("{storyboard_info}", storyboard_info_text)

        # 3. 调用VLM分析
        prompt = await PromptService.call_vlm_with_images(
            vlm,
            system_prompt,
            image_base64_list
        )
        await vlm.close()

        logger.info(f"[VLM分析] 成功 - 图片数量: {len(image_base64_list)}, 结果长度: {len(prompt)}")
        return {"prompt": prompt}

    except HTTPException:
        await vlm.close()
        raise
    except Exception as e:
        await vlm.close()
        logger.error(f"[VLM分析] 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
