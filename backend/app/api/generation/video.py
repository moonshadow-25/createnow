"""
Generation API - 视频生成相关端点
"""

import logging
import asyncio
import uuid
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Body, Request, UploadFile, File

from app.services import get_ai_service, PromptService, ImageService, AudioService
from app.services.ai.adapters.byteseed import ASSET_UNSUPPORTED_MODELS
from app.services.asset_service import VideoService
from app.core.config import settings
from app.core.context import get_current_data_root
from .models import VideoPromptRequest, VideoPromptSubagentRequest, VideoReversePromptRequest, VideoGenerateRequest, MultiSceneVideoPromptRequest, VideoSubtitleRemovalRequest, VideoBatchGenerateRequest
from .template_helpers import get_active_template
from .utils import check_project_budget, normalize_video_resolution, calc_video_compute_units, resolve_credits
from app.core.context import get_current_user
from app.models.project import normalize_global_style_config
from app.core.pricing import SUBTITLE_REMOVAL_COST

logger = logging.getLogger(__name__)


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


router = APIRouter()


SUPPORTED_RATIOS = {"16:9", "9:16", "21:9", "adaptive"}


def _parse_ratio_resolution(raw_resolution: Optional[str], raw_ratio: Optional[str]) -> Tuple[str, Optional[str]]:
    ratio = (raw_ratio or "").strip()
    if ratio not in SUPPORTED_RATIOS:
        ratio = ""

    value = (raw_resolution or "").strip()
    if not value:
        return "720p", ratio or None

    if value in {"1280x720", "720x1280", "21:9-720p"}:
        mapped_ratio = {"1280x720": "16:9", "720x1280": "9:16", "21:9-720p": "21:9"}[value]
        return "720p", ratio or mapped_ratio

    if value == "1920x1080":
        return "1080p", ratio or "16:9"

    matched = value.split("-", 1)
    if len(matched) == 2:
        candidate_ratio, candidate_resolution = matched
        normalized_resolution = normalize_video_resolution(candidate_resolution)
        if candidate_ratio in SUPPORTED_RATIOS:
            return normalized_resolution, ratio or candidate_ratio

    normalized_resolution = normalize_video_resolution(value)
    return normalized_resolution, ratio or None


def _resolve_video_params(project: dict, request: VideoGenerateRequest) -> Tuple[str, str]:
    global_style_config = normalize_global_style_config(project.get("ai_config", {}).get("global_style_config"))
    global_resolution_raw = global_style_config.get("global_resolution", "1280x720")
    global_resolution, global_ratio = _parse_ratio_resolution(global_resolution_raw, None)

    # 分镜链路优先使用全局设置；其他入口沿用请求参数
    if request.storyboard_id:
        resolution_source = global_resolution
        ratio_source = global_ratio
    else:
        resolution_source = request.resolution
        ratio_source = request.ratio

    resolved_resolution, resolved_ratio = _parse_ratio_resolution(resolution_source, ratio_source)

    # 非分镜入口：若请求显式传了 ratio，允许覆盖
    if not request.storyboard_id and request.ratio in SUPPORTED_RATIOS:
        resolved_ratio = request.ratio

    return resolved_resolution, (resolved_ratio or "16:9")


def _is_remote_url(url: str) -> bool:
    return isinstance(url, str) and url.startswith(("http://", "https://"))


def _is_local_video_api_url(url: str, project_id: str) -> bool:
    marker = f"/api/projects/{project_id}/videos/files/"
    parsed = urlparse(url)
    path = parsed.path or ""
    return marker in path or marker in url


def _build_ordered_assets(project_id: str, character_ids: List[str], scene_ids: List[str], prop_ids: List[str]) -> Dict[str, Any]:
    from app.services import AssetService

    ordered_characters: List[Dict[str, Any]] = []
    ordered_scenes: List[Dict[str, Any]] = []
    ordered_props: List[Dict[str, Any]] = []

    for cid in character_ids or []:
        char = AssetService.load_asset(project_id, "character", cid)
        if char:
            ordered_characters.append(char)

    for sid in scene_ids or []:
        scene = AssetService.load_asset(project_id, "scene", sid)
        if scene:
            ordered_scenes.append(scene)

    for pid in prop_ids or []:
        prop = AssetService.load_asset(project_id, "prop", pid)
        if prop:
            ordered_props.append(prop)

    assets_lines: List[str] = []
    img_idx = 1
    for char in ordered_characters:
        assets_lines.append(f"图{img_idx}（角色）：{char.get('name', '')} - {char.get('description', '')}")
        img_idx += 1
    for scene in ordered_scenes:
        assets_lines.append(f"图{img_idx}（场景）：{scene.get('name', '')} - {scene.get('description', '')}")
        img_idx += 1
    for prop in ordered_props:
        assets_lines.append(f"图{img_idx}（道具）：{prop.get('name', '')} - {prop.get('description', '')}")
        img_idx += 1

    audio_lines: List[str] = []
    audio_idx = 1
    for char in ordered_characters:
        if char.get("voice_enabled", True) and char.get("voice_audio_id"):
            audio_lines.append(f"@音频{audio_idx}是{char.get('name', '')}的声音")
            audio_idx += 1

    return {
        "characters": ordered_characters,
        "scenes": ordered_scenes,
        "props": ordered_props,
        "assets_desc": "\n".join(assets_lines) if assets_lines else "（无参考资产）",
        "audios_desc": "，".join(audio_lines) if audio_lines else "",
    }


def _extract_generated_asset_lines(prompt_text: str) -> List[str]:
    if not prompt_text:
        return []

    lines = prompt_text.splitlines()
    started = False
    collected: List[str] = []

    for raw in lines:
        line = raw.strip()
        if not started:
            if line.lower().startswith("[asset definitions]"):
                started = True
            continue

        if not line:
            continue

        if line.startswith("[") and not line.startswith("@图"):
            break

        if line.startswith("@图"):
            collected.append(line)
            continue

        if line.startswith("图"):
            collected.append(line)
            continue

        if collected:
            break

    return collected


def _enforce_asset_order_guard(prompt_text: str, ordered_assets: Dict[str, Any]) -> Dict[str, Any]:
    expected_lines: List[str] = []
    img_idx = 1

    for char in ordered_assets.get("characters", []):
        expected_lines.append(f"@图{img_idx} ({char.get('name', '')})")
        img_idx += 1
    for scene in ordered_assets.get("scenes", []):
        expected_lines.append(f"@图{img_idx} ({scene.get('name', '')})")
        img_idx += 1
    for prop in ordered_assets.get("props", []):
        expected_lines.append(f"@图{img_idx} ({prop.get('name', '')})")
        img_idx += 1

    actual_lines = _extract_generated_asset_lines(prompt_text)

    def _compact(s: str) -> str:
        return "".join(str(s or "").split()).replace("（", "(").replace("）", ")")

    expected_compact = [_compact(x) for x in expected_lines]
    actual_compact = [_compact(x) for x in actual_lines]

    if not expected_lines:
        return {
            "prompt": prompt_text,
            "asset_order_guard": {
                "enabled": True,
                "status": "ok",
                "expected": expected_lines,
                "actual": actual_lines,
                "expected_compact": expected_compact,
                "actual_compact": actual_compact,
                "mismatches": [],
                "message": "无资产需要校验",
            }
        }

    strict_match = expected_compact == actual_compact
    mismatch_count = max(len(expected_compact), len(actual_compact))
    mismatches: List[Dict[str, Any]] = []
    for i in range(mismatch_count):
        expected_item = expected_lines[i] if i < len(expected_lines) else ""
        actual_item = actual_lines[i] if i < len(actual_lines) else ""
        if _compact(expected_item) != _compact(actual_item):
            mismatches.append({
                "index": i,
                "expected": expected_item,
                "actual": actual_item,
            })

    return {
        "prompt": prompt_text,
        "asset_order_guard": {
            "enabled": True,
            "status": "ok" if strict_match else "mismatch",
            "expected": expected_lines,
            "actual": actual_lines,
            "expected_compact": expected_compact,
            "actual_compact": actual_compact,
            "mismatches": mismatches,
            "message": "asset definitions 顺序已校验" if strict_match else "asset definitions 顺序不一致，请按 expected 顺序使用 @图N",
        }
    }


def _get_createnow_api_key(project: dict) -> str:
    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    api_key = video_config.get("api_key", "")
    if api_key:
        return api_key

    from app.services.auth_service import get_auth_state
    auth = get_auth_state()
    return auth.get("api_key", "")


@router.post("/video-prompt")
async def generate_video_prompt(project_id: str, request: VideoPromptRequest):
    """生成视频提示词"""
    from app.services import ProjectService
    from .style_presets import get_video_style_suffix

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)

    # 使用辅助函数获取当前激活的视频模板
    custom_template = get_active_template(ai_config, "video")

    # 读取全局风格配置
    global_style_config = normalize_global_style_config(ai_config.get("global_style_config"))
    language = global_style_config.get("prompt_language", "zh")

    # 获取视频风格后缀
    video_style = global_style_config.get("video_style", {})
    style_suffix = ""
    if video_style.get("enabled", True):
        preset_id = video_style.get("preset_id", "none")
        if preset_id == "custom":
            style_suffix = video_style.get("custom_suffix", "")
        elif preset_id != "none":
            style_suffix = get_video_style_suffix(preset_id, language)

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

    scene_ids = [request.scene] if request.scene else []
    ordered_assets = _build_ordered_assets(
        project_id,
        request.characters or [],
        scene_ids,
        request.props or [],
    )

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
            custom_template=custom_template,
            language=language,
            style_suffix=style_suffix,
            assets_desc=ordered_assets["assets_desc"],
            audios_desc=ordered_assets["audios_desc"]
        )
        guarded = _enforce_asset_order_guard(result, ordered_assets)
        await llm.close()
        return guarded

    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video-prompt-subagent")
async def generate_video_prompt_subagent(project_id: str, request: VideoPromptSubagentRequest):
    """独立子代：单独为某个分镜生成并保存 video_prompt，含资产顺序拦截与自动重试"""
    from app.services import ProjectService
    from .style_presets import get_video_style_suffix

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    storyboard = AssetService.load_asset(project_id, "storyboard", request.storyboard_id)
    if not storyboard:
        raise HTTPException(status_code=404, detail="Storyboard not found")

    ai_config = project.get("ai_config", {})
    llm = get_ai_service(ai_config, "llm", project_id)
    custom_template = get_active_template(ai_config, "video")

    global_style_config = normalize_global_style_config(ai_config.get("global_style_config"))
    language = global_style_config.get("prompt_language", "zh")

    video_style = global_style_config.get("video_style", {})
    style_suffix = ""
    if video_style.get("enabled", True):
        preset_id = video_style.get("preset_id", "none")
        if preset_id == "custom":
            style_suffix = video_style.get("custom_suffix", "")
        elif preset_id != "none":
            style_suffix = get_video_style_suffix(preset_id, language)

    character_ids = storyboard.get("character_ids") or []
    scene_ids = storyboard.get("scene_ids") or ([storyboard["scene_id"]] if storyboard.get("scene_id") else [])
    prop_ids = storyboard.get("prop_ids") or []

    ordered_assets = _build_ordered_assets(project_id, character_ids, scene_ids, prop_ids)

    request_payload = {
        "storyboard_id": request.storyboard_id,
        "description": request.description or storyboard.get("description", ""),
        "dialogue": request.dialogue or storyboard.get("dialogue", ""),
        "action": request.action or storyboard.get("action", ""),
        "shot_type": request.shot_type or storyboard.get("shot_type", ""),
        "camera_angle": request.camera_angle or storyboard.get("camera_angle", ""),
        "duration": request.duration or storyboard.get("duration", 6),
        "character_ids": character_ids,
        "scene_ids": scene_ids,
        "prop_ids": prop_ids,
    }

    extra_retry_instruction = (
        "\n\n【硬性约束-重试】\n"
        "你必须严格输出 [Asset Definitions] 段，并按给定资产顺序逐行列出。\n"
        "格式必须为 @图N (资产名)，N 从 1 递增，不得缺失、跳号或交换。"
    )

    attempts: List[Dict[str, Any]] = []

    try:
        first_generated = await PromptService.generate_video_prompt(
            llm,
            description=request_payload["description"],
            dialogue=request_payload["dialogue"],
            action=request_payload["action"],
            shot_type=request_payload["shot_type"],
            camera_angle=request_payload["camera_angle"],
            characters=character_ids,
            scene=scene_ids[0] if scene_ids else "",
            props=prop_ids,
            duration=request_payload["duration"],
            custom_template=custom_template,
            language=language,
            style_suffix=style_suffix,
            assets_desc=ordered_assets["assets_desc"],
            audios_desc=ordered_assets["audios_desc"],
        )

        first_guarded = _enforce_asset_order_guard(first_generated, ordered_assets)
        attempts.append({
            "attempt": 1,
            "prompt": first_generated,
            "prompt_preview": (first_generated or "")[:500],
            "asset_order_guard": first_guarded["asset_order_guard"],
            "retry_enhanced": False,
        })

        final_generated = first_generated
        final_guarded = first_guarded

        if first_guarded["asset_order_guard"]["status"] != "ok":
            retry_template = (custom_template or "") + extra_retry_instruction
            second_generated = await PromptService.generate_video_prompt(
                llm,
                description=request_payload["description"],
                dialogue=request_payload["dialogue"],
                action=request_payload["action"],
                shot_type=request_payload["shot_type"],
                camera_angle=request_payload["camera_angle"],
                characters=character_ids,
                scene=scene_ids[0] if scene_ids else "",
                props=prop_ids,
                duration=request_payload["duration"],
                custom_template=retry_template,
                language=language,
                style_suffix=style_suffix,
                assets_desc=ordered_assets["assets_desc"],
                audios_desc=ordered_assets["audios_desc"],
            )
            second_guarded = _enforce_asset_order_guard(second_generated, ordered_assets)
            attempts.append({
                "attempt": 2,
                "prompt": second_generated,
                "prompt_preview": (second_generated or "")[:500],
                "asset_order_guard": second_guarded["asset_order_guard"],
                "retry_enhanced": True,
                "retry_instruction": extra_retry_instruction,
            })

            final_generated = second_generated
            final_guarded = second_guarded

        if final_guarded["asset_order_guard"]["status"] != "ok":
            await llm.close()
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "视频提示词资产顺序校验失败",
                    "request": request_payload,
                    "ordered_assets": {
                        "assets_desc": ordered_assets["assets_desc"],
                        "audios_desc": ordered_assets["audios_desc"],
                    },
                    "asset_order_guard": final_guarded["asset_order_guard"],
                    "attempt_count": len(attempts),
                    "attempts": attempts,
                }
            )

        storyboard["video_prompt"] = final_generated
        storyboard["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, "storyboard", storyboard)

        await llm.close()
        return {
            "prompt": final_generated,
            "saved": True,
            "storyboard_id": request.storyboard_id,
            "request": request_payload,
            "ordered_assets": {
                "assets_desc": ordered_assets["assets_desc"],
                "audios_desc": ordered_assets["audios_desc"],
            },
            "asset_order_guard": final_guarded["asset_order_guard"],
            "attempt_count": len(attempts),
            "attempts": attempts,
        }
    except HTTPException:
        await llm.close()
        raise
    except Exception as e:
        await llm.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video-reverse-prompt")
async def generate_video_reverse_prompt(project_id: str, request: VideoReversePromptRequest):
    """反推视频提示词（使用VLM分析图片）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 检查VLM配置，如果没有则回退到LLM
    vlm_config = ai_config.get("vlm", {})
    if vlm_config.get("api_url") and vlm_config.get("api_key"):
        vlm = get_ai_service(ai_config, "vlm", project_id)
    else:
        # 回退到LLM配置
        vlm = get_ai_service(ai_config, "llm", project_id)
        logger.warning(f"[反推提示词] VLM未配置，回退使用LLM")

    # 使用辅助函数获取当前激活的视频反推模板
    custom_template = get_active_template(ai_config, "video_reverse")

    try:
        result = await PromptService.generate_video_reverse_prompt(
            vlm,
            image_base64=request.image_base64,
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
        await vlm.close()
        return {"prompt": result}

    except Exception as e:
        await vlm.close()
        logger.error(f"[反推提示词] 生成失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/all-storyboard-videos")
async def generate_all_storyboard_videos_endpoint(project_id: str, request: VideoBatchGenerateRequest):
    """批量生成剧集下所有有视频提示词的分镜视频（后端自动收集关联资产图片）"""
    from app.api.tools.generation import handle_generate_all_storyboard_videos

    result = await handle_generate_all_storyboard_videos(project_id, {"episode_id": request.episode_id})
    return result


@router.post("/video")
async def generate_video(project_id: str, request: VideoGenerateRequest):
    """生成视频（支持单图和首尾帧模式）"""
    from app.services import ProjectService

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 检查项目预算
    check_project_budget(project)

    video_service = get_ai_service(ai_config, "video", project_id)

    # 允许请求覆盖项目配置中的 generate_audio
    if request.generate_audio is not None:
        video_service.generate_audio = request.generate_audio

    # 多模态路径（video_urls / audio_urls）：不需要 image_ids
    has_multimodal = bool(request.video_urls or request.audio_urls)

    # 自动注入角色主音色（仅当请求未手动指定 audio_urls）
    if not request.audio_urls:
        from app.services.asset_service import AssetService
        storyboard = AssetService.load_asset(project_id, "storyboard", request.storyboard_id)
        char_audio_urls = []
        audio_ref_lines = []
        audio_idx = 1
        for char_id in (storyboard or {}).get("character_ids", []):
            char = AssetService.load_asset(project_id, "character", char_id)
            if char and char.get("voice_enabled", True) and char.get("voice_audio_id"):
                audio = AudioService.get_audio(project_id, char["voice_audio_id"])
                if audio:
                    url = audio.get("audio_path")
                    if not url and audio.get("local_path"):
                        # 转为 base64 data URL
                        local_file = _get_projects_dir() / project_id / "audios" / "files" / audio["local_path"]
                        if local_file.exists():
                            import base64
                            ext = audio.get("format", "mp3")
                            data = local_file.read_bytes()
                            url = f"data:audio/{ext};base64,{base64.b64encode(data).decode()}"
                    if url:
                        char_audio_urls.append(url)
                        audio_ref_lines.append(f"@音频{audio_idx}是{char.get('name', '')}的声音")
                        audio_idx += 1
                        logger.info(f"[视频生成] 注入角色音色: char={char_id}, audio={audio['audio_id']}")
        if char_audio_urls:
            # 在 prompt 末尾追加音频引用说明（供 Seedance 2.0 理解角色声音对应关系）
            audio_ref_text = "，".join(audio_ref_lines)
            updated_prompt = request.prompt.rstrip() + f"\n{audio_ref_text}"
            request = request.model_copy(update={
                "audio_urls": char_audio_urls,
                "prompt": updated_prompt
            })
            has_multimodal = True

    # 使用 image_ids（已由 validator 自动转换）
    image_ids = list(request.image_ids) if request.image_ids else []

    multimodal_reference = ai_config.get("video", {}).get("multimodal_reference", False)

    resolved_resolution, resolved_ratio = _resolve_video_params(project, request)
    request = request.model_copy(update={
        "resolution": resolved_resolution,
        "ratio": resolved_ratio,
    })

    # 记录请求日志
    request_log = {
        "storyboard_id": request.storyboard_id,
        "episode_id": request.episode_id,
        "image_ids": image_ids,
        "prompt": request.prompt[:500] + "..." if len(request.prompt) > 500 else request.prompt,
        "duration": request.duration,
        "resolution": request.resolution,
        "ratio": request.ratio,
    }

    try:
        # 处理所有图片，转换为URL或base64
        image_urls = []
        video_model = request.model or ai_config.get("video", {}).get("model", "")
        skip_asset = video_model in ASSET_UNSUPPORTED_MODELS

        for image_id in (image_ids or []):
            image = ImageService.get_image(project_id, image_id)
            if not image:
                raise HTTPException(status_code=404, detail=f"Image {image_id} not found")

            image_url = None

            # 优先使用 Volcengine Asset ID（asset:// URI），不支持 asset 的模型跳过
            if not skip_asset and image.get("volcengine_asset_id") and image.get("volcengine_asset_status") == "Active":
                image_url = f"asset://{image['volcengine_asset_id']}"
                logger.info(f"[视频生成] 使用 Volcengine Asset URI: {image_url}")

            # 其次使用本地文件（转base64）
            if not image_url:
                local_path = image.get("local_path")
                if local_path:
                    local_file_path = _get_projects_dir() / project_id / "images" / "files" / local_path

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
                    detail=f"Image {image_id}: 本地文件不存在且无有效URL"
                )

            # 根据配置决定是否压缩图片到1080p（asset:// URI 跳过缩放）
            scale_to_1080p = ai_config.get("video", {}).get("scale_to_1080p", False)
            if scale_to_1080p and not image_url.startswith("asset://"):
                logger.info(f"[视频生成] 1080p缩放已启用，开始压缩图片")
                image_url = video_service.scale_image_to_1080p(image_url)
            else:
                logger.info(f"[视频生成] 1080p缩放已禁用，使用原始图片")

            image_urls.append(image_url)

        # 读取传输格式配置（默认使用multipart/form-data）
        use_multipart = ai_config.get("video", {}).get("use_multipart", True)
        logger.info(f"[视频生成] 传输格式: {'multipart/form-data' if use_multipart else 'JSON'}")

        # 调用视频生成服务
        if has_multimodal or not image_urls or (multimodal_reference and len(image_urls) > 1):
            # 多模态路径（Seedance 2.0 / 全能参考），也承载纯文本视频生成
            logger.info(f"[视频生成] 多模态模式: images={len(image_urls)}, videos={len(request.video_urls or [])}, audios={len(request.audio_urls or [])}")
            result = await video_service.generate_multimodal(
                prompt=request.prompt,
                image_urls=image_urls if image_urls else None,
                video_urls=request.video_urls,
                audio_urls=request.audio_urls,
                duration=request.duration,
                resolution=request.resolution,
                ratio=request.ratio,
                use_web_search=request.use_web_search,
                model=request.model,
            )
        elif len(image_urls) == 1:
            # 单图模式
            result = await video_service.generate(
                image_url=image_urls[0],
                prompt=request.prompt,
                duration=request.duration,
                resolution=request.resolution,
                ratio=request.ratio,
                model=request.model,
                use_multipart=use_multipart
            )
        else:
            # 多图模式（首尾帧）
            result = await video_service.generate_multi_image(
                image_urls=image_urls,
                prompt=request.prompt,
                duration=request.duration,
                resolution=request.resolution,
                ratio=request.ratio,
                model=request.model,
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
            "ratio": request.ratio,
            "estimated_cost": round(calc_video_compute_units(request.duration, request.resolution), 2),
            "actual_cost": resolve_credits(result, calc_video_compute_units(request.duration, request.resolution)),
            "credits_consumed": resolve_credits(result, calc_video_compute_units(request.duration, request.resolution)),
            "model": request.model or ai_config.get("video", {}).get("model", "sora"),
            "created_at": datetime.now().isoformat(),
            "created_by": get_current_user() or "",
            "task_id": result.get("task_id", ""),
            "status": "pending",  # 等待轮询
            "poll_count": 0,
            "last_poll_time": None,
            "last_poll_response": None,
            "generate_audio": request.generate_audio,
            "reference_media": request.reference_media or [],
        }

        # 保存视频记录到文件
        videos_dir = _get_projects_dir() / project_id / "videos"
        videos_dir.mkdir(exist_ok=True)
        video_file = videos_dir / f"{video_id}.json"
        with open(video_file, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        VideoService.save_video(project_id, record)

        return record

    except HTTPException:
        raise
    except Exception as e:
        await video_service.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/video-subtitle-removal")
async def create_video_subtitle_removal_task(project_id: str, request: VideoSubtitleRemovalRequest):
    """创建视频字幕擦除任务（生成新视频记录，不覆盖旧视频）"""
    from app.services import ProjectService

    source_video_url = (request.source_video_url or "").strip()
    if not _is_remote_url(source_video_url):
        raise HTTPException(status_code=400, detail="source_video_url 必须是远程 http(s) URL")

    if _is_local_video_api_url(source_video_url, project_id):
        raise HTTPException(status_code=400, detail="字幕擦除仅支持原始远程 URL，不支持本地视频 URL")

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    video_config = ai_config.get("video", {})
    if video_config.get("api_type") != "createnow":
        raise HTTPException(status_code=400, detail="字幕擦除仅在 CreateNow 官方接口配置下可用")

    api_key = _get_createnow_api_key(project)
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置 CreateNow API Key")

    video_service = get_ai_service(ai_config, "video", project_id)
    try:
        submit_result = await video_service.erase_subtitle(
            video_url=source_video_url,
            model=settings.CREATENOW_SUBTITLE_MODEL_ID,
        )
    finally:
        await video_service.close()

    if not submit_result.get("success"):
        raise HTTPException(status_code=502, detail=submit_result.get("error") or "字幕擦除任务提交失败")

    video_id = str(uuid.uuid4())
    record = {
        "video_id": video_id,
        "storyboard_id": request.storyboard_id,
        "episode_id": request.episode_id,
        "prompt": request.prompt or "去除字幕",
        "video_path": None,
        "duration": 0,
        "resolution": "",
        "ratio": "",
        "estimated_cost": 0,
        "actual_cost": 0,
        "model": settings.CREATENOW_SUBTITLE_MODEL_ID,
        "created_at": datetime.now().isoformat(),
        "created_by": get_current_user() or "",
        "task_id": submit_result.get("task_id", ""),
        "status": "pending",
        "poll_count": 0,
        "last_poll_time": None,
        "last_poll_response": submit_result,
        "operation_type": "subtitle_removal",
        "source_video_id": request.source_video_id,
        "source_video_url": source_video_url,
        "error": None,
    }

    videos_dir = _get_projects_dir() / project_id / "videos"
    videos_dir.mkdir(exist_ok=True)
    video_file = videos_dir / f"{video_id}.json"
    with open(video_file, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    VideoService.save_video(project_id, record)

    return record


@router.get("/videos")
async def list_videos(project_id: str, episode_id: str = None, library: bool = False, mine: bool = False):
    """列出项目的所有视频记录"""
    videos_dir = _get_projects_dir() / project_id / "videos"
    if not videos_dir.exists():
        return []

    current_user = get_current_user() or ""
    videos = []
    for video_file in videos_dir.glob("*.json"):
        try:
            with open(video_file, "r", encoding="utf-8") as f:
                video = json.load(f)
                if library:
                    # 视频库模式：只返回不属于任何分镜的视频
                    if video.get("storyboard_id") is not None:
                        continue
                elif episode_id:
                    # 按 episode_id 过滤
                    if video.get("episode_id") != episode_id:
                        continue
                if mine and (video.get("created_by") or "") != current_user:
                    continue
                videos.append(video)
        except Exception as e:
            logger.error(f"Error reading video file {video_file}: {e}")

    # 按创建时间倒序排列
    videos.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return videos


@router.post("/media/upload")
async def upload_media(request: Request, project_id: str, file: UploadFile = File(...)):
    """上传参考视频或音频文件，返回可公开访问的 URL"""
    content_type = file.content_type or ""

    if content_type.startswith("video/"):
        media_type = "video"
        allowed_exts = {".mp4", ".mov", ".avi", ".webm"}
        default_ext = ".mp4"
    elif content_type.startswith("audio/"):
        media_type = "audio"
        allowed_exts = {".mp3", ".wav", ".m4a", ".ogg", ".aac"}
        default_ext = ".mp3"
    else:
        raise HTTPException(status_code=400, detail="仅支持视频（mp4/mov/avi/webm）或音频（mp3/wav/m4a/ogg/aac）文件")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix and suffix not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {suffix}")

    media_id = str(uuid.uuid4())
    filename = f"{media_id}{suffix or default_ext}"

    media_dir = _get_projects_dir() / project_id / "generate" / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    with open(media_dir / filename, "wb") as f:
        f.write(content)

    base_url = str(request.base_url).rstrip("/")
    public_url = f"{base_url}/api/projects/{project_id}/generate/media/files/{filename}"

    return {"media_id": media_id, "media_type": media_type, "url": public_url, "filename": filename}


@router.get("/videos/{video_id}")
async def get_video(project_id: str, video_id: str):
    """获取单个视频记录"""
    video_file = _get_projects_dir() / project_id / "videos" / f"{video_id}.json"
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(video_file, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("/videos/{video_id}/poll")
async def poll_video_status(project_id: str, video_id: str):
    """轮询视频生成状态，更新视频记录"""
    from app.services import ProjectService

    # 获取视频记录
    video_file = _get_projects_dir() / project_id / "videos" / f"{video_id}.json"
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    with open(video_file, "r", encoding="utf-8") as f:
        video_record = json.load(f)

    # 仅 completed 作为不可恢复终态
    if video_record.get("status") == "completed":
        return video_record

    task_id = video_record.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="No task_id found for this video")

    # 获取项目配置
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})
    operation_type = video_record.get("operation_type")

    try:
        if operation_type == "subtitle_removal":
            video_service = get_ai_service(ai_config, "video", project_id)
            try:
                poll_result = await video_service.poll_subtitle_task(task_id)
            finally:
                await video_service.close()
        else:
            video_service = get_ai_service(ai_config, "video", project_id)
            try:
                raw_result = await video_service.poll_video_task(task_id)
            finally:
                await video_service.close()

            # 统一将临时轮询错误映射为 poll_failed，避免一次失败永久报废
            raw_status = raw_result.get("status")
            if not raw_result.get("success") and raw_status == "failed":
                poll_result = {
                    "success": False,
                    "status": "poll_failed",
                    "error": raw_result.get("error") or "轮询失败",
                    "raw_poll_response": raw_result.get("raw_poll_response"),
                }
            else:
                poll_result = raw_result

        # 更新视频记录
        video_record["poll_count"] = video_record.get("poll_count", 0) + 1
        video_record["last_poll_time"] = datetime.now().isoformat()
        video_record["last_poll_response"] = poll_result.get("raw_poll_response")

        status = poll_result.get("status")
        if status == "completed":
            video_record["status"] = "completed"
            video_record["video_path"] = poll_result.get("video_url")
            video_record["enhanced_prompt"] = poll_result.get("enhanced_prompt", "")
            video_record["error"] = None

            if operation_type == "subtitle_removal":
                video_record["estimated_cost"] = SUBTITLE_REMOVAL_COST
                video_record["actual_cost"] = SUBTITLE_REMOVAL_COST
                video_record["credits_consumed"] = SUBTITLE_REMOVAL_COST

            # 若平台返回实际消耗，回填 actual_cost
            platform_credits = poll_result.get("credits_consumed")
            if platform_credits is not None:
                video_record["credits_consumed"] = int(platform_credits)
                video_record["actual_cost"] = int(platform_credits)

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
        elif status in ("poll_failed", "failed"):
            video_record["status"] = "poll_failed"
            video_record["error"] = poll_result.get("error")
        else:
            # pending/in_progress/queued
            video_record["status"] = status or "pending"

        # 保存更新后的记录
        with open(video_file, "w", encoding="utf-8") as f:
            json.dump(video_record, f, ensure_ascii=False, indent=2)
        VideoService.save_video(project_id, video_record)

        return video_record

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error polling video {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/videos/{video_id}/set-primary")
async def set_primary_video(project_id: str, video_id: str, storyboard_id: str = Body(..., embed=True)):
    """设置主视频"""
    videos_dir = _get_projects_dir() / project_id / "videos"
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
                VideoService.save_video(project_id, video)
        except Exception as e:
            logger.error(f"Error updating video file {video_file}: {e}")

    # 设置目标视频为主视频
    target_video["is_primary"] = True
    with open(target_video_file, "w", encoding="utf-8") as f:
        json.dump(target_video, f, ensure_ascii=False, indent=2)
    VideoService.save_video(project_id, target_video)

    return {"success": True, "video": target_video}


@router.post("/multi-scene-video-prompt")
async def generate_multi_scene_video_prompt(
    project_id: str,
    request: MultiSceneVideoPromptRequest
):
    """生成多分镜融合视频提示词（使用LLM）"""
    from app.services import ProjectService, AssetService

    try:
        logger.info(f"Received multi-scene video prompt request for project {project_id}")
        logger.info(f"Request data: {request}")
        logger.info(f"Storyboard IDs: {request.storyboard_ids}")
    except Exception as e:
        logger.error(f"Error logging request: {e}")

    # 1. 获取项目
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 2. 获取所有分镜
    storyboards = []
    for sb_id in request.storyboard_ids:
        sb = AssetService.load_asset(project_id, "storyboard", sb_id)
        if sb:
            storyboards.append(sb)

    if not storyboards:
        raise HTTPException(status_code=404, detail="No storyboards found")

    # 按sequence排序
    storyboards.sort(key=lambda x: x.get("sequence", 0))

    # 3. 获取剧集剧本（假设所有分镜属于同一剧集）
    episode_id = storyboards[0].get("episode_id")
    if not episode_id:
        raise HTTPException(status_code=400, detail="Storyboards must belong to an episode")

    episode = AssetService.load_asset(project_id, "episode", episode_id)
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")

    script_content = episode.get("script", "")

    # 4. 收集所有涉及的资产（去重）
    character_ids = set()
    scene_ids = set()
    prop_ids = set()

    for sb in storyboards:
        if sb.get("character_ids"):
            character_ids.update(sb["character_ids"])
        if sb.get("scene_ids"):
            scene_ids.update(sb["scene_ids"])
        elif sb.get("scene_id"):
            scene_ids.add(sb["scene_id"])
        if sb.get("prop_ids"):
            prop_ids.update(sb["prop_ids"])

    # 5. 获取资产详细信息
    characters_info = []
    for char_id in character_ids:
        char = AssetService.load_asset(project_id, "character", char_id)
        if char:
            info = char.get("description", "")
            if char.get("age"):
                info += f"，{char['age']}岁"
            if char.get("gender"):
                info += f"，{char['gender']}"
            characters_info.append(info)

    scenes_info = []
    for scene_id in scene_ids:
        scene = AssetService.load_asset(project_id, "scene", scene_id)
        if scene:
            scenes_info.append(scene.get("description", ""))

    props_info = []
    for prop_id in prop_ids:
        prop = AssetService.load_asset(project_id, "prop", prop_id)
        if prop:
            props_info.append(prop.get("description", ""))

    # 6. 构建分镜信息
    storyboards_info = []
    total_duration = 0
    for i, sb in enumerate(storyboards):
        duration = sb.get("duration", 3)
        total_duration += duration

        info = f"分镜{i+1}（时长{duration}秒）：\n"
        info += f"  描述：{sb.get('description', '')}\n"
        if sb.get("dialogue"):
            info += f"  对白：{sb['dialogue']}\n"
        if sb.get("shot_type"):
            info += f"  镜头类型：{sb['shot_type']}\n"
        if sb.get("camera_angle"):
            info += f"  镜头角度：{sb['camera_angle']}\n"
        if sb.get("action"):
            info += f"  动作：{sb['action']}\n"

        storyboards_info.append(info)

    # 7. 获取提示词模板
    ai_config = project.get("ai_config", {})
    template = get_active_template(ai_config, "multi_scene_video")

    if not template:
        raise HTTPException(status_code=500, detail="Multi-scene video prompt template not found")

    # 8. 填充模板
    prompt = template.format(
        script_content=script_content,
        storyboards_info="\n".join(storyboards_info),
        characters_info="；".join(characters_info) if characters_info else "无",
        scenes_info="；".join(scenes_info) if scenes_info else "无",
        props_info="；".join(props_info) if props_info else "无"
    )

    # 9. 调用LLM生成
    llm = get_ai_service(ai_config, "llm", project_id)

    try:
        response = await llm.chat([
            {"role": "user", "content": prompt}
        ])

        generated_prompt = response.get("content", "")

        await llm.close()

        return {
            "prompt": generated_prompt,
            "total_duration": total_duration,
            "storyboard_count": len(storyboards)
        }
    except Exception as e:
        await llm.close()
        logger.error(f"Error generating multi-scene video prompt: {e}")
        raise HTTPException(status_code=500, detail=str(e))

