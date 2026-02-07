import logging
import asyncio
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Body, Query, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
import json

logger = logging.getLogger(__name__)

from app.services import get_ai_service, PromptService, ImageService, AssetService, AILogService
from app.core.config import settings

router = APIRouter(prefix="/projects/{project_id}/generate", tags=["generation"])


class PromptTemplateUpdate(BaseModel):
    image_prompt_template: Optional[str] = None
    video_prompt_template: Optional[str] = None
    storyboard_generation_prompt_template: Optional[str] = None
    storyboard_image_prompt_template: Optional[str] = None
    storyboard_image_edit_prompt_template: Optional[str] = None
    image_edit_prompt_template: Optional[str] = None


class ImagePromptRequest(BaseModel):
    asset_type: str  # "character", "scene", "prop", "storyboard"
    description: str
    # 分镜特有字段（仅当asset_type为storyboard时使用）
    shot_type: str = ""
    action: str = ""
    camera_angle: str = ""
    # 是否使用图生图编辑模板（仅当asset_type为storyboard时有效）
    use_image_edit: bool = False


class ImageGenerateRequest(BaseModel):
    asset_id: str
    asset_type: str
    prompt: str
    negative_prompt: str = ""
    size: Optional[str] = None  # 分辨率，格式如 "1024x1024" 或 "1x1"，为空时使用配置


class VideoPromptRequest(BaseModel):
    storyboard_id: str
    description: str
    dialogue: str = ""
    action: str = ""
    shot_type: str = ""
    camera_angle: str = ""
    characters: list = []
    scene: str = ""
    props: list = []
    duration: int = 6


class VideoGenerateRequest(BaseModel):
    storyboard_id: str
    episode_id: str
    image_id: str
    prompt: str
    duration: int = 6
    resolution: str = "1920x1080"


class ImageEditPromptRequest(BaseModel):
    """生成图像编辑提示词请求"""
    parent_asset_id: str  # 父角色ID
    child_asset_id: str   # 子角色ID


class ImageEditRequest(BaseModel):
    """图像编辑请求（基于参考图生成新图）"""
    asset_id: str                    # 目标资产ID
    asset_type: str = "character"    # 资产类型
    prompt: str                      # 编辑提示词
    size: Optional[str] = None       # 图片尺寸，格式如 "1024x1024" 或 "1x1"，为空时使用配置
    reference_image_ids: List[str] = []  # 参考图片ID列表（可选）
    reference_image_urls: List[str] = [] # 参考图片URL列表（可选），直接使用URL而不需要先上传


class FusionPromptRequest(BaseModel):
    """生成融合图片提示词请求"""
    asset_ids: List[str]  # 源资产ID列表
    asset_types: List[str]  # 源资产类型列表
    user_prompt: str  # 用户输入的融合提示词


class FusionImageRequest(BaseModel):
    """融合图片生成请求"""
    asset_ids: List[str]  # 源资产ID列表
    asset_types: List[str]  # 源资产类型列表
    prompt: str  # 完整的融合提示词
    image_ids: List[str]  # 源图片ID列表
    size: Optional[str] = None  # 图片尺寸
    canvas_element_id: Optional[str] = None  # 画布元素ID（用于关联生成的图片）


def _parse_size(size_str: str) -> tuple[int, int]:
    """
    解析尺寸字符串，支持多种格式：
    - "1024x1024" -> (1024, 1024)
    - "1x1" -> (1536, 1536)
    - "16x9" -> (2048, 1152)
    - "1920x1080" -> (1920, 1080)
    """
    if not size_str:
        return 1536, 1536

    try:
        parts = size_str.lower().split("x")
        if len(parts) != 2:
            return 1536, 1536

        w_ratio = float(parts[0].strip())
        h_ratio = float(parts[1].strip())

        # 如果是比例格式（如 1x1, 16x9），转换为实际像素
        if w_ratio < 100 or h_ratio < 100:
            # 1x1 -> 1536x1536
            # 16x9 -> 2048x1152
            if abs(w_ratio - h_ratio) < 0.01:  # 正方形
                return 1536, 1536
            elif w_ratio > h_ratio:  # 横向 (如16x9)
                return 2048, 1152
            else:  # 纵向
                return 1152, 2048
        else:
            # 直接是像素值
            return int(w_ratio), int(h_ratio)
    except (ValueError, ZeroDivisionError):
        return 1536, 1536


@router.post("/image-prompt")
async def generate_image_prompt(project_id: str, request: ImagePromptRequest):
    """生成图片提示词"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 获取项目的自定义提示词模板
    custom_templates = ai_config.get("prompt_templates", {})

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
            # 根据是否使用图生图编辑模式选择模板
            if request.use_image_edit:
                custom_template = custom_templates.get("storyboard_image_edit_prompt_template")
                # 如果没有自定义模板，使用默认模板
                if not custom_template:
                    custom_template = DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_edit_prompt_template")
            else:
                custom_template = custom_templates.get("storyboard_image_prompt_template")
                # 如果没有自定义模板，使用默认模板
                if not custom_template:
                    custom_template = DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_prompt_template")
            request_log["shot_type"] = request.shot_type
            request_log["action"] = request.action
            request_log["camera_angle"] = request.camera_angle
            request_log["use_image_edit"] = request.use_image_edit
            request_log["has_custom_template"] = bool(custom_templates.get("storyboard_image_edit_prompt_template" if request.use_image_edit else "storyboard_image_prompt_template"))

            result = await PromptService.generate_storyboard_image_prompt(
                llm,
                request.description,
                shot_type=request.shot_type,
                action=request.action,
                camera_angle=request.camera_angle,
                custom_template=custom_template
            )
        else:
            # 其他资产类型使用通用图片生成方法
            custom_template = custom_templates.get("image_prompt_template")
            request_log["has_custom_template"] = bool(custom_template)

            result = await PromptService.generate_image_prompt(
                llm,
                request.asset_type,
                request.description,
                custom_template=custom_template
            )
        await llm.close()
        return result

    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/image")
async def generate_image(project_id: str, request: ImageGenerateRequest):
    """生成图片"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 获取配置的分辨率，支持 "1x1"、"16x9" 等格式
    default_sizes = {
        "character": "1x1",
        "scene": "16x9",
        "prop": "1x1",
        "storyboard": "16x9"
    }
    configured_sizes = ai_config.get("image_sizes", {})
    size_str = request.size or configured_sizes.get(request.asset_type) or default_sizes.get(request.asset_type, "1x1")

    # 转换尺寸格式：支持 "1024x1024" 或 "1x1" 等格式
    width, height = _parse_size(size_str)

    image_service = get_ai_service(ai_config, "image", project_id)

    try:
        result = await image_service.generate(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            width=width,
            height=height,
            size_str=size_str  # 传递原始比例字符串给OpenAI API
        )

        await image_service.close()

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        # 保存生成记录
        record = {
            "asset_id": request.asset_id,
            "asset_type": request.asset_type,
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "width": width,
            "height": height,
            "image_path": result.get("image_url"),
            "model": ai_config.get("image", {}).get("model", "dall-e-3"),
            "created_at": datetime.now().isoformat()
        }

        saved = ImageService.save_generation_record(project_id, record)

        # 更新资产的主图（如果是第一张）
        images = ImageService.list_images(project_id, request.asset_id)
        if len(images) == 1:
            ImageService.set_primary_image(project_id, request.asset_id, saved["image_id"])
            AssetService.update_asset_image(
                project_id, request.asset_type, request.asset_id, saved["image_id"]
            )

        # 【自动下载】生成成功后自动下载图片到本地
        from app.services.image_download_service import ImageDownloadService
        image_url = result.get("image_url")
        if image_url and image_url.startswith(("http://", "https://")):
            try:
                await ImageDownloadService.download_and_save_image(
                    project_id=project_id,
                    image_id=saved["image_id"],
                    url=image_url,
                    asset_type=request.asset_type
                )
            except Exception as e:
                logger.warning(f"自动下载图片失败 (image_id: {saved['image_id']}): {e}")

        return saved

    except HTTPException:
        raise
    except Exception as e:
        await image_service.close()
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


@router.post("/image-edit")
async def edit_image(project_id: str, request: ImageEditRequest):
    """图像编辑（基于参考图生成新图）"""
    from app.services import ProjectService
    from pathlib import Path

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 验证资产存在
    asset = AssetService.load_asset(project_id, request.asset_type, request.asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

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
            project_dir = settings.PROJECTS_DIR / project_id
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
    for url in request.reference_image_urls:
        url = url.strip()
        if url and url.startswith(("http://", "https://")):
            reference_image_paths.append(url)
            logger.info(f"[图生图] 使用手动输入URL: {url[:100]}")

    if not reference_image_paths:
        raise HTTPException(status_code=400, detail="At least one reference image is required")

    ai_config = project.get("ai_config", {})

    # 获取配置的分辨率，支持 "1x1"、"16x9" 等格式
    default_sizes = {
        "character": "1x1",
        "scene": "16x9",
        "prop": "1x1",
        "storyboard": "16x9"
    }
    configured_sizes = ai_config.get("image_sizes", {})
    size_str = request.size or configured_sizes.get(request.asset_type) or default_sizes.get(request.asset_type, "1x1")

    # 转换为 API 需要的格式 (如 "1024x1024")
    width, height = _parse_size(size_str)
    size_for_api = f"{width}x{height}"

    image_service = get_ai_service(ai_config, "image", project_id)

    # 基本请求日志
    request_log = {
        "asset_id": request.asset_id,
        "asset_type": request.asset_type,
        "reference_image_ids": request.reference_image_ids,
        "prompt": request.prompt[:500] + "..." if len(request.prompt) > 500 else request.prompt,
        "size_config": size_str,
        "size_api": size_for_api,
    }

    try:
        image_config = ai_config.get("image", {})
        model = image_config.get("image_edit_model") or image_config.get("model", "wan2.6-image")

        primary_image = reference_image_paths[0]
        extra_images = reference_image_paths[1:] if len(reference_image_paths) > 1 else None

        # 添加实际发送的图片URL到请求日志中（用于调试）
        request_log["primary_image_url"] = primary_image[:200] + "..." if len(primary_image) > 200 else primary_image
        if extra_images:
            request_log["extra_image_urls"] = [img[:200] + "..." if len(img) > 200 else img for img in extra_images]

        result = await image_service.edit(
            image_path=primary_image,
            prompt=request.prompt,
            size=size_str,      # 比例格式 "16x9" - 用于 OpenAI
            width=width,        # 像素值 2048 - 用于 DashScope
            height=height,      # 像素值 1152 - 用于 DashScope
            model=model,
            reference_images=extra_images
        )

        await image_service.close()

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        record = {
            "asset_id": request.asset_id,
            "asset_type": request.asset_type,
            "prompt": request.prompt,
            "negative_prompt": "",
            "width": width,
            "height": height,
            "image_path": result.get("image_url"),
            "model": ai_config.get("image", {}).get("model", "dall-e-3"),
            "created_at": datetime.now().isoformat()
        }

        saved = ImageService.save_generation_record(project_id, record)

        images = ImageService.list_images(project_id, request.asset_id)
        if len(images) == 1:
            ImageService.set_primary_image(project_id, request.asset_id, saved["image_id"])
            AssetService.update_asset_image(
                project_id, request.asset_type, request.asset_id, saved["image_id"]
            )

        # 【自动下载】生成成功后自动下载图片到本地
        from app.services.image_download_service import ImageDownloadService
        image_url = result.get("image_url")
        if image_url and image_url.startswith(("http://", "https://")):
            try:
                await ImageDownloadService.download_and_save_image(
                    project_id=project_id,
                    image_id=saved["image_id"],
                    url=image_url,
                    asset_type=request.asset_type
                )
            except Exception as e:
                logger.warning(f"自动下载图片失败 (image_id: {saved['image_id']}): {e}")

        return saved

    except HTTPException:
        raise
    except Exception as e:
        await image_service.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fusion-prompt")
async def generate_fusion_prompt(project_id: str, request: FusionPromptRequest):
    """生成融合图片提示词"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
    from pathlib import Path

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
            project_dir = settings.PROJECTS_DIR / project_id
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

    # 获取配置的分辨率
    size_str = request.size or "1x1"
    width, height = _parse_size(size_str)
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
                "created_at": datetime.now().isoformat()
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


@router.post("/video-prompt")
async def generate_video_prompt(project_id: str, request: VideoPromptRequest):
    """生成视频提示词"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 获取项目的自定义提示词模板
    custom_templates = ai_config.get("prompt_templates", {})
    custom_template = custom_templates.get("video_prompt_template")

    # 记录请求日志
    request_log = {
        "description": request.description[:500] + "..." if len(request.description) > 500 else request.description,
        "dialogue": request.dialogue,
        "action": request.action,
        "shot_type": request.shot_type,
        "camera_angle": request.camera_angle,
        "characters": request.characters,
        "scene": request.scene,
        "props": request.props,
        "duration": request.duration,
    }

    try:
        result = await PromptService.generate_video_prompt(
            llm,
            description=request.description,
            dialogue=request.dialogue,
            action=request.action,
            shot_type=request.shot_type,
            camera_angle=request.camera_angle,
            characters=request.characters,
            scene=request.scene,
            props=request.props,
            duration=request.duration,
            custom_template=custom_template
        )
        await llm.close()
        return {"prompt": result}

    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video")
async def generate_video(project_id: str, request: VideoGenerateRequest):
    """生成视频"""
    from app.services import ProjectService
    from app.core.config import settings
    from datetime import datetime
    import uuid

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 获取图片
    image = ImageService.get_image(project_id, request.image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    ai_config = project.get("ai_config", {})
    video_service = get_ai_service(ai_config, "video", project_id)

    # 记录请求日志
    request_log = {
        "storyboard_id": request.storyboard_id,
        "episode_id": request.episode_id,
        "image_id": request.image_id,
        "prompt": request.prompt[:500] + "..." if len(request.prompt) > 500 else request.prompt,
        "duration": request.duration,
        "resolution": request.resolution,
    }

    try:
        # 智能判断：优先本地base64，降级到URL
        image_url = None

        # 优先使用本地文件（转base64）
        local_path = image.get("local_path")
        if local_path:
            local_file_path = settings.PROJECTS_DIR / project_id / "images" / "files" / local_path

            if local_file_path.exists():
                try:
                    from app.services.image_download_service import ImageDownloadService
                    image_url = ImageDownloadService.image_to_base64_url(local_file_path)
                    logger.info(f"[视频生成] 使用本地图片 (base64): {local_path}")
                except Exception as e:
                    logger.warning(f"[视频生成] 读取本地图片失败 {local_path}: {e}，尝试使用URL")

        # 降级到外部URL
        if not image_url:
            image_path = image.get("image_path")
            if image_path and image_path.startswith(("http://", "https://")):
                image_url = image_path
                logger.info(f"[视频生成] 使用外部URL: {image_path[:100]}")

        if not image_url:
            raise HTTPException(
                status_code=404,
                detail=f"Image {request.image_id}: 本地文件不存在且无有效URL"
            )

        # 根据配置决定是否压缩图片到1080p（默认不压缩）
        scale_to_1080p = ai_config.get("video", {}).get("scale_to_1080p", False)
        if scale_to_1080p:
            logger.info(f"[视频生成] 1080p缩放已启用，开始压缩图片")
            image_url = video_service.scale_image_to_1080p(image_url)
        else:
            logger.info(f"[视频生成] 1080p缩放已禁用，使用原始图片")

        # 读取传输格式配置（默认使用multipart/form-data）
        use_multipart = ai_config.get("video", {}).get("use_multipart", True)
        logger.info(f"[视频生成] 传输格式: {'multipart/form-data' if use_multipart else 'JSON'}")

        result = await video_service.generate(
            image_url=image_url,
            prompt=request.prompt,
            duration=request.duration,
            resolution=request.resolution,
            use_multipart=use_multipart
        )

        await video_service.close()

        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error"))

        # 创建视频记录（状态为 pending，等待轮询更新）
        video_id = str(uuid.uuid4())
        record = {
            "video_id": video_id,
            "storyboard_id": request.storyboard_id,
            "episode_id": request.episode_id,
            "prompt": request.prompt,
            "video_path": None,  # 尚未生成完成
            "duration": request.duration,
            "resolution": request.resolution,
            "model": ai_config.get("video", {}).get("model", "sora"),
            "created_at": datetime.now().isoformat(),
            "task_id": result.get("task_id", ""),
            "status": "pending",  # 等待轮询
            "poll_count": 0,
            "last_poll_time": None,
            "last_poll_response": None,
        }

        # 保存视频记录到文件
        videos_dir = settings.PROJECTS_DIR / project_id / "videos"
        videos_dir.mkdir(exist_ok=True)
        video_file = videos_dir / f"{video_id}.json"
        with open(video_file, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        return record

    except HTTPException:
        raise
    except Exception as e:
        await video_service.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/videos")
async def list_videos(project_id: str, episode_id: str = None):
    """列出项目的所有视频记录"""
    from app.core.config import settings

    videos_dir = settings.PROJECTS_DIR / project_id / "videos"
    if not videos_dir.exists():
        return []

    videos = []
    for video_file in videos_dir.glob("*.json"):
        try:
            with open(video_file, "r", encoding="utf-8") as f:
                video = json.load(f)
                # 如果指定了 episode_id，则过滤
                if episode_id and video.get("episode_id") != episode_id:
                    continue
                videos.append(video)
        except Exception as e:
            logger.error(f"Error reading video file {video_file}: {e}")

    # 按创建时间倒序排列
    videos.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return videos


# ==================== 视频下载相关 API ====================
# 注意：这些路由必须在 /videos/{video_id} 之前定义，否则会被当作 video_id 匹配

@router.post("/videos/download-all")
async def download_all_videos(project_id: str, episode_id: Optional[str] = None):
    """一键下载所有视频到本地"""
    from app.services import ProjectService
    from app.services.video_download_service import VideoDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 异步执行下载任务
    asyncio.create_task(
        VideoDownloadService.download_all_videos(project_id, episode_id)
    )

    return {
        "success": True,
        "message": "视频下载任务已启动"
    }


@router.get("/videos/download-status")
async def get_video_download_status(project_id: str):
    """获取视频下载状态"""
    from app.services import ProjectService
    from app.services.video_download_service import VideoDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = VideoDownloadService.get_download_status(project_id)
    statistics = VideoDownloadService.get_download_statistics(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": statistics,
        "current": status.get("current_video", ""),
        "errors": status.get("errors", [])[:10]
    }


@router.get("/videos/download-statistics")
async def get_video_download_statistics(project_id: str, episode_id: Optional[str] = None):
    """获取视频下载统计"""
    from app.services import ProjectService
    from app.services.video_download_service import VideoDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return VideoDownloadService.get_download_statistics(project_id, episode_id)


# ==================== 视频导出相关 API ====================
# 注意：这些路由必须在 /videos/{video_id} 之前定义

class VideoExportRequest(BaseModel):
    episode_id: str


@router.post("/videos/export")
async def export_episode_videos(project_id: str, request: VideoExportRequest):
    """导出剧集的所有分镜视频（按顺序命名并拼接）"""
    from app.services import ProjectService
    from app.services.video_export_service import VideoExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 清理旧的导出文件
    VideoExportService.cleanup_old_exports(project_id)

    # 异步执行导出任务
    asyncio.create_task(
        VideoExportService.export_episode_videos(project_id, request.episode_id)
    )

    return {
        "success": True,
        "message": "视频导出任务已启动"
    }


@router.get("/videos/export-status")
async def get_video_export_status(project_id: str):
    """获取视频导出状态"""
    from app.services import ProjectService
    from app.services.video_export_service import VideoExportService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = VideoExportService.get_export_status(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": status.get("progress", 0),
        "current_step": status.get("current_step", ""),
        "download_url": status.get("download_url"),
        "errors": status.get("errors", [])[:10]
    }


@router.get("/videos/export-download/{filename}")
async def download_export_file(project_id: str, filename: str):
    """下载导出的 zip 文件"""
    from fastapi.responses import FileResponse
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 验证文件名格式，防止路径遍历
    if not filename.startswith("export_") or not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    export_path = settings.PROJECTS_DIR / project_id / "exports" / filename
    if not export_path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")

    return FileResponse(
        path=str(export_path),
        filename=filename,
        media_type="application/zip"
    )


@router.get("/videos/{video_id}")
async def get_video(project_id: str, video_id: str):
    """获取单个视频记录"""
    from app.core.config import settings

    video_file = settings.PROJECTS_DIR / project_id / "videos" / f"{video_id}.json"
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(video_file, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("/videos/{video_id}/poll")
async def poll_video_status(project_id: str, video_id: str):
    """轮询视频生成状态，更新视频记录"""
    from app.services import ProjectService
    from app.core.config import settings
    from datetime import datetime

    # 获取视频记录
    video_file = settings.PROJECTS_DIR / project_id / "videos" / f"{video_id}.json"
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(video_file, "r", encoding="utf-8") as f:
        video_record = json.load(f)

    # 如果已经完成或失败，直接返回
    if video_record.get("status") in ("completed", "failed"):
        return video_record

    task_id = video_record.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="No task_id found for this video")

    # 获取项目配置
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_service = get_ai_service(ai_config, "video", project_id)

    try:
        # 调用轮询接口
        poll_result = await video_service.poll_video_task(task_id)
        await video_service.close()

        # 更新视频记录
        video_record["poll_count"] = video_record.get("poll_count", 0) + 1
        video_record["last_poll_time"] = datetime.now().isoformat()
        video_record["last_poll_response"] = poll_result.get("raw_poll_response")

        if poll_result.get("status") == "completed":
            video_record["status"] = "completed"
            video_record["video_path"] = poll_result.get("video_url")
            video_record["enhanced_prompt"] = poll_result.get("enhanced_prompt", "")

            # 【自动下载】视频生成完成后自动下载到本地
            from app.services.video_download_service import VideoDownloadService
            video_url = poll_result.get("video_url")
            if video_url and video_url.startswith(("http://", "https://")):
                try:
                    # 异步下载，不阻塞轮询响应
                    asyncio.create_task(
                        VideoDownloadService.download_and_save_video(
                            project_id=project_id,
                            video_id=video_id,
                            url=video_url
                        )
                    )
                except Exception as e:
                    logger.warning(f"启动视频自动下载失败 (video_id: {video_id}): {e}")
        elif poll_result.get("status") == "failed":
            video_record["status"] = "failed"
            video_record["error"] = poll_result.get("error")
        else:
            # 仍在 pending
            video_record["status"] = poll_result.get("status", "pending")

        # 保存更新后的记录
        with open(video_file, "w", encoding="utf-8") as f:
            json.dump(video_record, f, ensure_ascii=False, indent=2)

        return video_record

    except Exception as e:
        await video_service.close()
        logger.error(f"Error polling video {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/images/{asset_id}")
async def list_asset_images(project_id: str, asset_id: str):
    """列出资产的所有图片"""
    return ImageService.list_images(project_id, asset_id)


@router.post("/images/upload")
async def upload_image(
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
        project_dir = settings.PROJECTS_DIR / project_id
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
            "width": 0,
            "height": 0,
            "image_path": None,  # 没有远程URL
            "local_path": f"{asset_type}/{filename}",
            "created_at": datetime.now().isoformat(),
            "is_primary": False
        }

        # 保存记录
        saved_record = ImageService.save_generation_record(project_id, record)

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


@router.post("/videos/{video_id}/set-primary")
async def set_primary_video(project_id: str, video_id: str, storyboard_id: str = Body(..., embed=True)):
    """设置主视频"""
    from app.core.config import settings

    videos_dir = settings.PROJECTS_DIR / project_id / "videos"
    if not videos_dir.exists():
        raise HTTPException(status_code=404, detail="No videos found")

    # 获取目标视频
    target_video_file = videos_dir / f"{video_id}.json"
    if not target_video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(target_video_file, "r", encoding="utf-8") as f:
        target_video = json.load(f)

    # 验证分镜ID匹配
    if target_video.get("storyboard_id") != storyboard_id:
        raise HTTPException(status_code=400, detail="Video does not belong to this storyboard")

    # 取消该分镜的其他视频的主视频状态
    for video_file in videos_dir.glob("*.json"):
        try:
            with open(video_file, "r", encoding="utf-8") as f:
                video = json.load(f)

            if video.get("storyboard_id") == storyboard_id and video.get("is_primary"):
                video["is_primary"] = False
                with open(video_file, "w", encoding="utf-8") as f:
                    json.dump(video, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error updating video file {video_file}: {e}")

    # 设置目标视频为主视频
    target_video["is_primary"] = True
    with open(target_video_file, "w", encoding="utf-8") as f:
        json.dump(target_video, f, ensure_ascii=False, indent=2)

    return {"success": True, "video": target_video}


# 默认提示词模板
DEFAULT_PROMPT_TEMPLATES = {
    "image_prompt_template": """你是一位世界顶级的AI绘画提示词专家，精通Midjourney、Stable Diffusion、DALL-E等主流AI绘画工具的提示词编写。

【任务】
根据提供的{asset_type}资产描述，生成高质量的英文AI绘画提示词。

【资产描述】
类型：{asset_type}
描述：{description}

【提示词编写要求】

1. **结构要求**：返回JSON格式，包含：
   - positive_prompt: 正向提示词（英文，150-300词）
   - negative_prompt: 负向提示词（英文，50-100词）

2. **正向提示词必须包含**：
   - 主体描述（详细、具体）
   - 艺术风格（如：Pixar 3D animation style, anime style, realistic oil painting等）
   - 画面构图（如：close-up shot, medium shot, bird's eye view等）
   - 光影效果（如：soft lighting, dramatic shadows, golden hour等）
   - 色彩基调（如：vibrant colors, warm tones, cool color palette等）
   - 质感细节（如：highly detailed, sharp focus, 8K resolution等）
   - 氛围营造（根据描述添加适当的氛围词）

3. **负向提示词必须包含**：
   - 质量相关：low quality, blurry, pixelated, distorted, low resolution
   - 瑕疵相关：ugly, deformed, malformed, bad anatomy, extra limbs
   - 风格不匹配：photorealistic（如果是要卡通风格）、realistic（如果是要插画风格）
   - 技术问题：watermark, signature, text, username, artist name

4. **风格匹配指南**：
   - 如果描述包含"卡通"、"动画"、"Pixar"、"迪士尼"等 → 使用Pixar/Disney 3D animation style
   - 如果描述包含"日漫"、"二次元"、"anime"等 → 使用anime/manga style
   - 如果描述包含"写实"、"真实"、"真人"等 → 使用photorealistic/hyperrealistic style
   - 如果描述包含"油画"、"水彩"、"插画"等 → 使用相应绘画风格
   - 如果描述包含"3D"、"立体"、"拟人化"等 → 强调3D rendering, volumetric lighting

5. **特别注意事项**：
   - 仔细分析描述中的所有信息，不要遗漏重要细节
   - 如果描述中已有风格关键词，务必在提示词中体现并强化
   - 确保提示词逻辑清晰，前后一致
   - 使用专业的艺术和摄影术语
   - 英文表达要地道、准确

【输出格式】
只返回JSON，不要其他说明文字：
{{
  "positive_prompt": "完整的英文正向提示词",
  "negative_prompt": "完整的英文负向提示词"
}}""",

    "video_prompt_template": """你是一位专业的AI视频生成提示词专家，精通Sora、Runway、Pika等视频生成工具的提示词编写。

【任务】
根据分镜信息，生成高质量的英文视频生成提示词。

【分镜信息】
画面描述：{description}
出场角色：{characters}
场景：{scene}
道具：{props}
运镜方式：{camera_movement}
时长：{duration}秒

【提示词编写要求】

1. **内容结构**：
   - 开场画面描述（静态场景建立）
   - 主体动作/运动（核心动态内容）
   - 镜头运动（与camera_movement参数保持一致）
   - 画面变化（光线、色彩、视角的演变）
   - 结尾画面（可留开放式结尾）

2. **必须包含的元素**：
   - 运动描述：使用动态动词（如：moves slowly, camera pans to, zoom in on等）
   - 节奏控制：根据时长合理分配动作节奏
   - 视觉效果：lighting changes, color shifts, transitions等
   - 情感氛围：通过运动和变化传达的情绪

3. **运镜匹配**：
   - 平移（pan）：描述横扫过的场景元素
   - 推拉（zoom in/out）：描述前景/背景的变化
   - 跟踪（tracking）：描述跟随主体的运动
   - 升降（tilt）：描述上下视角的转换
   - 环绕（orbit）：描述环绕主体的全景展现

4. **时长考虑**：
   - 5秒：简洁动作，1-2个主要变化
   - 10秒：中等复杂度，2-3个变化阶段
   - 15秒以上：复杂运动，多阶段演变

5. **表达要求**：
   - 全英文，语法正确
   - 时态使用现在进行时（is moving, camera pans）
   - 详细的形容词和副词增强表现力
   - 专业的影视术语（如：depth of field, rack focus, slow motion等）

【输出格式】
返回JSON格式：
{{
  "prompt": "完整的英文视频生成提示词"
}}""",

    "storyboard_generation_prompt_template": """你是一位专业的影视分镜设计师，精通视觉叙事和镜头语言设计。

【任务】
根据以下剧本内容，生成详细的AI分镜描述，用于自动生成分镜画面。

【剧本内容】
{script}

【分镜设计要求】

1. **镜头多样性**：
   - 使用不同景别：特写、近景、中景、全景、远景
   - 变换拍摄角度：平视、俯视、仰视、倾斜
   - 适当运用推、拉、摇、移、跟等运镜方式

2. **叙事节奏**：
   - 根据剧情高潮和低谷调整镜头长度
   - 关键情节使用特写或慢动作
   - 转场场景使用全景或空镜

3. **视觉呈现**：
   - 注重构图平衡和视觉引导
   - 考虑光线和阴影效果
   - 确保画面信息层次清晰

4. **设计输出**：
   为每个镜头生成详细的视觉描述，包括：
   - 画面主体和构图
   - 角色动作和表情
   - 环境细节和氛围
   - 色彩和光线建议

【输出格式】
返回JSON数组，每个分镜包含：
{{
  "sequence": 镜头序号,
  "shot_type": "镜头类型（特写/近景/中景/全景/远景）",
  "camera_angle": "镜头角度（平视/仰视/俯视/鸟瞰）",
  "description": "详细的画面描述",
  "action": "动作描述",
  "dialogue": "对白（如有）",
  "duration": "建议时长（秒）"
}}""",

    "image_edit_prompt_template": """你是一个专业的AI图像编辑提示词专家。根据主角色和子角色的信息，生成用于图像编辑的提示词。

【主角色信息】
名称：{parent_name}
描述：{parent_description}
性别：{parent_gender}
年龄：{parent_age}

【子角色信息】
名称：{child_name}
描述：{child_description}
性别：{child_gender}
年龄：{child_age}

【任务】
基于主角色的参考图，生成图像编辑提示词，使其成为子角色的形象。保持主角色的基本面部特征和整体风格，但根据子角色的描述调整服装、发型、表情、姿态等细节。

【要求】
1. 保持角色面部特征的相似性（因为这是同一���角色的不同造型）
2. 根据子角色描述调整服装、发型、配饰等
3. 保持与主角色相同或相似的画风风格
4. 用英文返回，格式为：
   - prompt: 图像编辑提示词（描述需要做出的改变）

【输出格式】
返回JSON格式：
{{
  "prompt": "详细的英文图像编辑提示词"
}}""",

    "storyboard_image_prompt_template": """你是一位世界顶级的AI绘画专家，专精于将分镜描述转换为高质量的Midjourney/Stable Diffusion提示词。

【任务】
根据分镜描述，生成专业级的AI绘画提示词，确保输出的画面完全符合分镜要求。

【分镜信息】
镜头描述：{description}
镜头类型：{shot_type}
动作要求：{action}
镜头角度：{camera_angle}

【提示词生成要求】

1. **精确还原**：
   - 完全遵循分镜的所有构图要求
   - 准确呈现角色动作和表情
   - 精确还原场景和道具细节

2. **艺术质量**：
   - 使用专业构图术语
   - 强调光影和色彩表现
   - 添加适当的细节描述

3. **风格匹配**：
   - 根据镜头类型选择合适的艺术风格
   - 保持画风的一致性
   - 体现分镜的情感氛围

4. **技术优化**：
   - 8K超高清细节
   - 专业渲染参数
   - 最佳长宽比 --ar 16:9

【输出格式】
返回JSON格式：
{{
  "positive_prompt": "完整的英文正向提示词",
  "negative_prompt": "完整的英文负向提示词"
}}""",

    "storyboard_image_edit_prompt_template": """你是一位世界顶级的影视分镜生成大师，精通图生图技术，能够将多个参考图像完美融合到一个分镜画面中。

【任务】
这是一个图生图任务。你将获得多个参考图像（按image1, image2, image3...顺序），请基于这些参考图像生成符合分镜要求的全新画面。

【输入信息】
{description}

【提示词编写要求】

1. **引用格式**：
   - 使用 "the man in image1" / "the woman in image2" / "the table in image3" 格式引用参考图
   - 不要使用角色名字，图像API无法理解名字
   - 明确描述如何组合多个参考图像到一个画面中

2. **画面组合**：
   - 根据分镜要求，合理布局各个参考图像中的元素
   - 考虑角色之间的位置关系、前后景层次
   - 确保场景和道具自然融入画面

3. **镜头语言**：
   - 根据镜头类型（{shot_type}）选择合适的构图方式
   - 根据镜头角度（{camera_angle}）调整视角和透视
   - 添加运镜暗示，增强画面动感

4. **艺术质量**：
   - 保持画面风格统一
   - 添加适当的光影效果和氛围描述
   - 强调细节质感和色彩和谐

【提示词编写示例】
- "Combine the man in image1 and the woman in image2 in the office scene from image3, with the table from image4 visible in the foreground, medium shot, soft lighting"
- "A close-up shot showing the character from image1 holding the prop from image5, dramatic shadows, emotional expression"
- "Stylize the handbag in image1 with the colours and texture from image2, placed on the table from image3, product photography style"
- "Full body shot of the character from image1 standing in the scene from image2, golden hour lighting, cinematic composition"

【输出格式】
返回JSON格式：
{{
  "positive_prompt": "完整的英文图生图提示词，包含如何组合各参考图像的描述",
  "negative_prompt": "完整的英文负向提示词"
}}"""
}


@router.get("/prompt-templates")
async def get_prompt_templates(project_id: str):
    """获取项目的提示词模板"""
    from app.services import ProjectService, PromptService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 从项目配置中获取自定义模板，如果没有则使用默认值
    custom_templates = project.get("ai_config", {}).get("prompt_templates", {})

    # 如果没有自定义模板，使用 PromptService 中的默认模板
    if not custom_templates.get("storyboard_generation_prompt_template"):
        from app.services import PromptService
        custom_templates["storyboard_generation_prompt_template"] = PromptService.STORYBOARD_DESC_TEMPLATE
    if not custom_templates.get("storyboard_image_prompt_template"):
        # 为分镜图片生成创建默认模板
        custom_templates["storyboard_image_prompt_template"] = """你是一位世界顶级的AI绘画专家，专精于将分镜描述转换为高质量的绘画提示词。

【分镜信息】
分镜描述：{description}
镜头类型：{shot_type}
动作要求：{action}
镜头角度：{camera_angle}

【提示词生成要求】
1. **精确还原**：
   - 完全遵循分镜的所有构图要求
   - 准确呈现角色动作和表情
   - 精确还原场景和道具细节

2. **艺术质量**：
   - 使用专业构图术语
   - 强调光影和色彩表现
   - 添加适当的细节描述

3. **风格匹配**：
   - 根据镜头类型选择合适的艺术风格
   - 保持画风的一致性

【输出格式】
返回JSON格式：
{{
  "positive_prompt": "完整的英文正向提示词",
  "negative_prompt": "完整的英文负向提示词"
}}"""

    return {
        "image_prompt_template": custom_templates.get("image_prompt_template", DEFAULT_PROMPT_TEMPLATES["image_prompt_template"]),
        "video_prompt_template": custom_templates.get("video_prompt_template", DEFAULT_PROMPT_TEMPLATES["video_prompt_template"]),
        "storyboard_generation_prompt_template": custom_templates.get("storyboard_generation_prompt_template", PromptService.STORYBOARD_DESC_TEMPLATE),
        "storyboard_image_prompt_template": custom_templates.get("storyboard_image_prompt_template", custom_templates.get("storyboard_image_prompt_template") or DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_prompt_template", "")),
        "storyboard_image_edit_prompt_template": custom_templates.get("storyboard_image_edit_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("storyboard_image_edit_prompt_template", "")),
        "image_edit_prompt_template": custom_templates.get("image_edit_prompt_template", DEFAULT_PROMPT_TEMPLATES.get("image_edit_prompt_template", "")),
        "is_custom": bool(custom_templates)
    }


@router.put("/prompt-templates")
async def update_prompt_templates(project_id: str, templates: PromptTemplateUpdate):
    """更新项目的提示词模板"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 更新项目的提示词模板
    ai_config = project.get("ai_config", {})
    prompt_templates = ai_config.get("prompt_templates", {})

    if templates.image_prompt_template is not None:
        prompt_templates["image_prompt_template"] = templates.image_prompt_template
    if templates.video_prompt_template is not None:
        prompt_templates["video_prompt_template"] = templates.video_prompt_template
    if templates.storyboard_generation_prompt_template is not None:
        prompt_templates["storyboard_generation_prompt_template"] = templates.storyboard_generation_prompt_template
    if templates.storyboard_image_prompt_template is not None:
        prompt_templates["storyboard_image_prompt_template"] = templates.storyboard_image_prompt_template
    if templates.storyboard_image_edit_prompt_template is not None:
        prompt_templates["storyboard_image_edit_prompt_template"] = templates.storyboard_image_edit_prompt_template
    if templates.image_edit_prompt_template is not None:
        prompt_templates["image_edit_prompt_template"] = templates.image_edit_prompt_template

    ai_config["prompt_templates"] = prompt_templates

    # 保存项目
    ProjectService.update_project(project_id, ai_config=ai_config)

    return {"success": True, "message": "提示词模板已更新"}


@router.post("/prompt-templates/reset")
async def reset_prompt_templates(project_id: str):
    """重置���默认提示词模板"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 清除自定义模板，恢复默认值
    ai_config = project.get("ai_config", {})
    ai_config["prompt_templates"] = {}

    ProjectService.update_project(project_id, ai_config=ai_config)

    return {"success": True, "message": "已恢复默认提示词模板"}


# ==================== AI 日志相关 API ====================

@router.get("/ai-logs")
async def get_ai_logs(
    project_id: str,
    type: Optional[str] = Query(None, description="日志类型: llm/image/video"),
    limit: int = Query(100, description="返回条数限制"),
    offset: int = Query(0, description="偏移量")
):
    """获取项目的AI交互日志"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    logs = AILogService.get_logs(
        project_id=project_id,
        interaction_type=type,
        limit=limit,
        offset=offset
    )

    total = AILogService.get_log_count(project_id, interaction_type=type)

    return {
        "logs": logs,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.delete("/ai-logs")
async def clear_ai_logs(
    project_id: str,
    type: Optional[str] = Query(None, description="要清除的日志类型，不传则清除全部")
):
    """清除项目的AI交互日志"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = AILogService.clear_logs(project_id, interaction_type=type)

    return {
        "success": True,
        "deleted": result["deleted"]
    }


# ==================== 图片下载相关 API ====================

@router.post("/images/download-all")
async def download_all_images(project_id: str):
    """一键下载所有图片到本地"""
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 异步执行下载任务
    asyncio.create_task(
        ImageDownloadService.download_all_images(project_id)
    )

    return {
        "success": True,
        "message": "下载任务已启动"
    }


@router.get("/images/download-status")
async def get_download_status(project_id: str):
    """获取图片下载状态"""
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    status = ImageDownloadService.get_download_status(project_id)
    statistics = ImageDownloadService.get_download_statistics(project_id)

    return {
        "status": status.get("status", "idle"),
        "progress": statistics,
        "current": status.get("current_image", ""),
        "errors": status.get("errors", [])[:10]
    }


@router.get("/images/download-statistics")
async def get_download_statistics(project_id: str):
    """获取图片下载统计"""
    from app.services import ProjectService
    from app.services.image_download_service import ImageDownloadService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return ImageDownloadService.get_download_statistics(project_id)
