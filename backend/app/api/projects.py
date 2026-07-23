from fastapi import APIRouter, HTTPException, Request, Query
from typing import List, Optional
from pydantic import BaseModel
import asyncio
import concurrent.futures
import json
import threading
import time
import uuid
from datetime import datetime

from app.services import ProjectService
from app.services.asset_service import AssetService, ImageService, VideoService
from app.services.auth_service import get_auth_state
from app.services.user_service import get_user_by_username
from app.core.config import settings
from app.core.context import get_current_data_root
from app.api.generation.utils import calc_video_compute_units, get_image_cost, get_video_cost

router = APIRouter(prefix="/projects", tags=["projects"])

PROJECT_HOME_STATS_CONCURRENCY = 16
POLICY_VIOLATION_ERROR_CODE = "OutputVideoSensitiveContentDetected.PolicyViolation"
_project_stats_locks: dict[str, threading.Lock] = {}
_project_stats_locks_guard = threading.Lock()

# 专用线程池：用于 glob + read + json.load 等 I/O 密集型操作
_ASSET_LOADER_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=32)

# 项目加载状态追踪（asyncio 层面）
# "loaded" = 数据已在进程缓存中; "loading" = 正在加载; None/缺失 = 未加载
_project_load_state: dict[str, str] = {}
_project_ready_events: dict[str, asyncio.Event] = {}
_state_guard = asyncio.Lock()


def _get_project_stats_lock(project_id: str) -> threading.Lock:
    with _project_stats_locks_guard:
        lock = _project_stats_locks.get(project_id)
        if lock is None:
            lock = threading.Lock()
            _project_stats_locks[project_id] = lock
        return lock


def _find_error_code(value) -> str | None:
    if isinstance(value, str):
        if POLICY_VIOLATION_ERROR_CODE in value:
            return POLICY_VIOLATION_ERROR_CODE
        try:
            parsed = json.loads(value)
        except Exception:
            return None
        return _find_error_code(parsed)
    if isinstance(value, dict):
        code = value.get("code")
        if code == POLICY_VIOLATION_ERROR_CODE:
            return code
        for nested in value.values():
            found = _find_error_code(nested)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_error_code(item)
            if found:
                return found
    return None


def _is_legacy_policy_violation_unrefunded(video: dict) -> bool:
    if video.get("billing_started_at") or video.get("refund_status") or video.get("billing_status"):
        return False
    if get_video_cost(video) <= 0:
        return False
    return _find_error_code(video) == POLICY_VIOLATION_ERROR_CODE


def _get_policy_violation_cost(video: dict) -> float:
    return get_video_cost(video) if _is_legacy_policy_violation_unrefunded(video) else 0.0


def _has_video_input(video: dict) -> bool:
    if video.get("video_urls"):
        return True
    for item in video.get("reference_media") or []:
        if isinstance(item, dict) and item.get("type") == "video":
            return True
    return False


# 计算视频算力（兼容旧字段）
def _gvc(v: dict) -> float:
    return get_video_cost(v)


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


def _preinit_caches(project_id: str) -> None:
    """预初始化 project_id 的缓存容器，避免 7 线程并发时的 setdefault 竞态"""
    from app.services.asset_service import _assets_cache, _images_cache, _videos_cache
    if project_id not in _assets_cache:
        _assets_cache[project_id] = {}
    if project_id not in _images_cache:
        _images_cache[project_id] = []
    if project_id not in _videos_cache:
        _videos_cache[project_id] = []


def _load_all_project_assets(project_id: str) -> dict:
    """并行加载项目的全部 7 类资产数据到进程缓存，返回各项结果。

    策略：先单独加载 images（5860 文件是瓶颈），填充 _images_cache 后
    再并行加载其他 6 类。这样并发请求在 _get_images_cache 的锁上等待，
    锁释放后立即命中缓存，避免多个线程同时读盘。
    """
    _preinit_caches(project_id)
    results = {}
    t0 = time.perf_counter()

    # 第一阶段：先加载 images（最重的一类，填充 _images_cache）
    t_img = time.perf_counter()
    results["images"] = ImageService.list_images(project_id)
    dt_img = 1000 * (time.perf_counter() - t_img)
    print(
        f"[PRELOAD] project={project_id[:8]} | asset_type=images (PHASE 1, solo) | "
        f"result_count={len(results['images'])} | resolve={dt_img:.1f}ms"
    )

    # 第二阶段：images 缓存已就绪，并行加载其余 6 类
    t2 = time.perf_counter()
    other_futures = {
        "storyboards": _ASSET_LOADER_EXECUTOR.submit(AssetService.list_assets, project_id, "storyboard"),
        "episodes": _ASSET_LOADER_EXECUTOR.submit(AssetService.list_assets, project_id, "episode"),
        "characters": _ASSET_LOADER_EXECUTOR.submit(AssetService.list_assets, project_id, "character"),
        "scenes": _ASSET_LOADER_EXECUTOR.submit(AssetService.list_assets, project_id, "scene"),
        "props": _ASSET_LOADER_EXECUTOR.submit(AssetService.list_assets, project_id, "prop"),
        "videos": _ASSET_LOADER_EXECUTOR.submit(VideoService.list_videos, project_id),
    }
    for key, future in other_futures.items():
        t_item = time.perf_counter()
        results[key] = future.result()
        dt = 1000 * (time.perf_counter() - t_item)
        print(
            f"[PRELOAD] project={project_id[:8]} | asset_type={key} (phase 2) | "
            f"result_count={len(results[key]) if isinstance(results[key], list) else '?'} | "
            f"resolve={dt:.1f}ms"
        )

    total_ms = 1000 * (time.perf_counter() - t0)
    print(f"[PRELOAD] project={project_id[:8]} | DONE | total={total_ms:.1f}ms")

    # 第三阶段：预热 video_service.VideoService 缓存
    # storyboards/episode handler 使用的是 video_service.VideoService（独立缓存）
    # 此处扫描全量视频 JSON 写入缓存，避免后续请求 15s+ 冷扫描
    try:
        from app.services.video_service import VideoService as VsVideoService
        storyboard_ids = [s["asset_id"] for s in results.get("storyboards", [])]
        t_vs = time.perf_counter()
        VsVideoService.get_primary_videos_batch(project_id, storyboard_ids)
        dt_vs = 1000 * (time.perf_counter() - t_vs)
        print(f"[PRELOAD] project={project_id[:8]} | video_service_cache_warm | resolve={dt_vs:.1f}ms")
    except Exception as e:
        print(f"[PRELOAD] project={project_id[:8]} | video_service_cache_warm FAILED: {e}")

    return results


async def _ensure_project_loaded(project_id: str) -> None:
    """确保项目数据已加载到进程缓存。若已在加载中则等待，若已加载则立即返回。"""
    from app.services.asset_service import _assets_cache, _images_cache, _videos_cache

    # 快速路径：内存中已有数据
    has_assets = project_id in _assets_cache
    has_images = project_id in _images_cache
    has_videos = project_id in _videos_cache
    has_cache = has_assets or has_images or has_videos
    if has_cache:
        print(
            f"[ENSURE LOADED] SKIP project={project_id[:8]} | "
            f"reason=already_cached | "
            f"_assets_cache={has_assets} | "
            f"_images_cache={has_images} | "
            f"_videos_cache={has_videos}"
        )
        return

    # 检查是否需要等待正在进行的加载（先持锁读取状态，再在锁外等待）
    async with _state_guard:
        state = _project_load_state.get(project_id)
        if state == "loaded":
            _project_load_state.pop(project_id, None)  # 清理过时状态
            return
        if state == "loading":
            event = _project_ready_events[project_id]
        else:
            # 标记为加载中
            _project_load_state[project_id] = "loading"
            event = asyncio.Event()
            _project_ready_events[project_id] = event

    if state == "loading":
        print(f"[ENSURE LOADED] WAIT project={project_id[:8]} | waiting for another request to finish loading")
        await event.wait()
        print(f"[ENSURE LOADED] WAIT_DONE project={project_id[:8]} | load completed by another request")
        return

    # 开始加载（event 已创建，state 已标记为 loading）
    t_load = time.perf_counter()
    print(f"[ENSURE LOADED] TRIGGER project={project_id[:8]} | starting _load_all_project_assets")
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_ASSET_LOADER_EXECUTOR, _load_all_project_assets, project_id)
        dt = 1000 * (time.perf_counter() - t_load)
        print(f"[ENSURE LOADED] DONE project={project_id[:8]} | load took {dt:.1f}ms")
    finally:
        async with _state_guard:
            _project_load_state[project_id] = "loaded"
            event.set()


def _build_project_stats(project_id: str, assets: dict = None) -> dict:
    """构建项目统计数据（复用缓存，避免磁盘遍历）。

    Args:
        project_id: 项目 ID
        assets: 预加载的资产数据，包含 storyboards/episodes/characters/scenes/props/images/videos。
                若为 None，则从缓存或磁盘加载。
    """
    if assets is not None:
        storyboards = assets["storyboards"]
        videos = assets["videos"]
        images = assets["images"]
        episodes = assets["episodes"]
        characters = assets["characters"]
        scenes = assets["scenes"]
        props = assets["props"]
    else:
        storyboards = AssetService.list_assets(project_id, "storyboard")
        videos = VideoService.list_videos(project_id)
        images = ImageService.list_images(project_id)
        episodes = AssetService.list_assets(project_id, "episode")
        characters = AssetService.list_assets(project_id, "character")
        scenes = AssetService.list_assets(project_id, "scene")
        props = AssetService.list_assets(project_id, "prop")
    total_storyboards = len(storyboards)
    storyboards_with_image = sum(1 for s in storyboards if s.get("image_id"))

    from app.api.generation.utils import get_image_cost as _gic, get_video_cost as _gvc

    completed_storyboard_ids: set = set()
    total_video_seconds = 0.0
    storyboard_video_seconds = 0.0
    total_video_compute_units = 0.0
    storyboard_video_compute_units = 0.0
    failed_video_compute_units = 0.0
    video_edit_seconds = 0.0
    for v in videos:
        compute_units = _gvc(v)
        failed_video_compute_units += _get_policy_violation_cost(v)
        total_video_compute_units += compute_units
        if v.get("storyboard_id"):
            storyboard_video_compute_units += compute_units
        # UI 指标：仅已完成视频
        if v.get("status") == "completed":
            duration = float(v.get("duration") or 0)
            total_video_seconds += duration
            if _has_video_input(v):
                video_edit_seconds += duration
            if v.get("storyboard_id"):
                storyboard_video_seconds += duration
                completed_storyboard_ids.add(v["storyboard_id"])

    # 图片消耗改为按记录遍历（尊重 actual_cost / ZERO_COST_MODELS）
    total_image_cost = sum(_gic(img) for img in images)
    total_images = len(images)
    generated_images = sum(1 for img in images if img.get("model") not in {"manual_upload", "split"})
    total_assets = len(characters) + len(scenes) + len(props)
    other_cost = total_storyboards * 40 + total_assets * 4
    total_compute_spent = round(total_image_cost + total_video_compute_units + other_cost, 2)

    return {
        "episode_count": len(episodes),
        "total_storyboards": total_storyboards,
        "storyboards_with_image": storyboards_with_image,
        "storyboards_with_video": len(completed_storyboard_ids),
        "total_images": total_images,
        "generated_images": generated_images,
        "total_image_cost": round(total_image_cost, 2),
        "total_video_seconds": total_video_seconds,
        "video_edit_seconds": video_edit_seconds,
        "storyboard_video_seconds": storyboard_video_seconds,
        "total_video_compute_units": total_video_compute_units,
        "storyboard_video_compute_units": storyboard_video_compute_units,
        "failed_video_compute_units": round(failed_video_compute_units, 2),
        "other_cost": other_cost,
        "total_compute_spent": total_compute_spent,
    }


def _build_user_cost_summary(projects: list[dict]) -> dict:
    """基于已加载项目列表按用户汇总实际消耗（复用内存缓存，不扫磁盘）"""
    user_costs: dict[str, dict] = {}

    for project in projects:
        project_id = project.get("project_id")
        if not project_id:
            continue

        for img in ImageService.list_images(project_id):
            username = (img.get("created_by") or "").strip() or "__unknown__"
            cost = get_image_cost(img)
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += cost
            entry["total_cost"] += cost

        for video in VideoService.list_videos(project_id):
            username = (video.get("created_by") or "").strip() or "__unknown__"
            cost = get_video_cost(video)
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
            entry["video_cost"] += cost
            entry["failed_video_cost"] += _get_policy_violation_cost(video)
            entry["total_cost"] += cost

    unknown = user_costs.pop("__unknown__", {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
    users = []
    for username, costs in sorted(user_costs.items(), key=lambda x: x[1]["total_cost"], reverse=True):
        user = get_user_by_username(username)
        users.append({
            "username": username,
            "display_name": user.get("display_name") if user else username,
            **costs,
        })

    return {
        "users": users,
        "unknown_cost": round(unknown["total_cost"], 2),
    }


def _build_project_cost_breakdown(project_id: str, assets: dict = None) -> dict:
    daily_costs: dict[str, dict] = {}
    episode_costs: dict[str, dict] = {}

    def add_daily_cost(date: str, cost_type: str, cost: float) -> None:
        if not date or len(date) != 10 or cost <= 0:
            return
        entry = daily_costs.setdefault(date, {"date": date, "image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
        entry[cost_type] += cost
        entry["total_cost"] += cost

    def add_episode_cost(episode_id: str, cost_type: str, cost: float) -> None:
        if not episode_id or cost <= 0:
            return
        entry = episode_costs.setdefault(episode_id, {
            "episode_id": episode_id,
            "name": "未知剧集",
            "episode_number": 999999,
            "image_cost": 0.0,
            "video_cost": 0.0,
            "failed_video_cost": 0.0,
            "total_cost": 0.0,
        })
        entry[cost_type] += cost
        entry["total_cost"] += cost

    if assets is not None:
        episodes = assets["episodes"]
        storyboards = assets["storyboards"]
        images = assets["images"]
        videos = assets["videos"]
    else:
        episodes = AssetService.list_assets(project_id, "episode")
        storyboards = AssetService.list_assets(project_id, "storyboard")
        images = ImageService.list_images(project_id)
        videos = VideoService.list_videos(project_id)

    storyboard_episode_map = {
        storyboard.get("asset_id"): storyboard.get("episode_id")
        for storyboard in storyboards
        if storyboard.get("asset_id") and storyboard.get("episode_id")
    }

    for index, episode in enumerate(episodes, start=1):
        episode_id = episode.get("asset_id")
        if not episode_id:
            continue
        episode_number = episode.get("episode_number") or index
        episode_costs[episode_id] = {
            "episode_id": episode_id,
            "name": episode.get("name") or f"第 {episode_number} 集",
            "episode_number": episode_number,
            "image_cost": 0.0,
            "video_cost": 0.0,
            "failed_video_cost": 0.0,
            "total_cost": 0.0,
        }

    for img in images:
        cost = get_image_cost(img)
        created_at = img.get("created_at")
        if created_at:
            add_daily_cost(str(created_at)[:10], "image_cost", cost)
        if img.get("asset_type") == "storyboard":
            episode_id = storyboard_episode_map.get(img.get("asset_id"))
            if episode_id:
                add_episode_cost(episode_id, "image_cost", cost)

    for video in videos:
        cost = get_video_cost(video)
        failed_cost = _get_policy_violation_cost(video)
        created_at = video.get("created_at")
        if created_at:
            add_daily_cost(str(created_at)[:10], "video_cost", cost)
            if failed_cost:
                add_daily_cost(str(created_at)[:10], "failed_video_cost", failed_cost)
        episode_id = storyboard_episode_map.get(video.get("storyboard_id"))
        if episode_id:
            add_episode_cost(episode_id, "video_cost", cost)
            if failed_cost:
                add_episode_cost(episode_id, "failed_video_cost", failed_cost)

    return {
        "daily_costs": [
            {
                "date": item["date"],
                "image_cost": round(item["image_cost"], 2),
                "video_cost": round(item["video_cost"], 2),
                "failed_video_cost": round(item["failed_video_cost"], 2),
                "total_cost": round(item["total_cost"], 2),
            }
            for item in sorted(daily_costs.values(), key=lambda x: x["date"])
            if item["total_cost"] > 0
        ],
        "episode_costs": [
            {
                "episode_id": item["episode_id"],
                "name": item["name"],
                "episode_number": item["episode_number"],
                "image_cost": round(item["image_cost"], 2),
                "video_cost": round(item["video_cost"], 2),
                "failed_video_cost": round(item["failed_video_cost"], 2),
                "total_cost": round(item["total_cost"], 2),
            }
            for item in sorted(episode_costs.values(), key=lambda x: x.get("episode_number") or 0)
            if item["total_cost"] > 0
        ],
    }


def _build_project_daily_costs(project_id: str) -> list[dict]:
    return _build_project_cost_breakdown(project_id)["daily_costs"]


def _build_project_user_costs(project_id: str, images: list[dict] = None, videos: list[dict] = None) -> tuple[dict[str, dict], dict[str, float]]:
    """构建项目用户消耗统计。

    Args:
        project_id: 项目 ID
        images: 预加载的图片记录列表。若为 None，则从缓存/磁盘加载。
        videos: 预加载的视频记录列表。若为 None，则从缓存/磁盘加载。
    """
    if images is None:
        images = ImageService.list_images(project_id)
    if videos is None:
        videos = VideoService.list_videos(project_id)

    user_costs: dict[str, dict] = {}
    unknown_costs = {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0}

    for img in images:
        username = (img.get("created_by") or "").strip()
        cost = get_image_cost(img)
        if username:
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += cost
            entry["total_cost"] += cost
        else:
            unknown_costs["image_cost"] += cost
            unknown_costs["total_cost"] += cost

    for video in videos:
        username = (video.get("created_by") or "").strip()
        cost = get_video_cost(video)
        if username:
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
            entry["video_cost"] += cost
            entry["failed_video_cost"] += _get_policy_violation_cost(video)
            entry["total_cost"] += cost
        else:
            unknown_costs["video_cost"] += cost
            unknown_costs["failed_video_cost"] += _get_policy_violation_cost(video)
            unknown_costs["total_cost"] += cost

    return user_costs, unknown_costs


def _build_user_cost_summary_from_project_costs(project_costs: list[dict]) -> dict:
    user_costs: dict[str, dict] = {}
    unknown_cost = 0.0

    for item in project_costs:
        unknown_cost += float(item.get("unknown_cost") or 0)
        for username, costs in (item.get("user_costs") or {}).items():
            entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "failed_video_cost": 0.0, "total_cost": 0.0})
            entry["image_cost"] += float(costs.get("image_cost") or 0)
            entry["video_cost"] += float(costs.get("video_cost") or 0)
            entry["failed_video_cost"] += float(costs.get("failed_video_cost") or 0)
            entry["total_cost"] += float(costs.get("total_cost") or 0)

    users = []
    for username, costs in sorted(user_costs.items(), key=lambda x: x[1]["total_cost"], reverse=True):
        user = get_user_by_username(username)
        users.append({
            "username": username,
            "display_name": user.get("display_name") if user else username,
            "image_cost": round(costs["image_cost"], 2),
            "video_cost": round(costs["video_cost"], 2),
            "failed_video_cost": round(costs["failed_video_cost"], 2),
            "total_cost": round(costs["total_cost"], 2),
        })

    return {"users": users, "unknown_cost": round(unknown_cost, 2)}


async def _get_project_home_stats_async(project_id: str) -> dict:
    """异步版本：先尝试快照，失败则并行加载资产后计算"""
    from app.services.project_stats_snapshot_service import read_snapshot, write_snapshot

    # 1. 检查快照
    snapshot = await asyncio.to_thread(read_snapshot, project_id)
    if snapshot and snapshot.get("unknown_costs"):
        print(f"[STATS SNAPSHOT HIT] project={project_id[:8]}")
        return snapshot
    print(f"[STATS SNAPSHOT MISS] project={project_id[:8]} | will load assets and compute")

    # 2. 确保项目数据已加载（自动处理并发去重）
    await _ensure_project_loaded(project_id)

    # 3. 从内存缓存获取数据（此时数据已在缓存中）
    images = ImageService.list_images(project_id)
    videos = VideoService.list_videos(project_id)
    assets = {
        "storyboards": AssetService.list_assets(project_id, "storyboard"),
        "episodes": AssetService.list_assets(project_id, "episode"),
        "characters": AssetService.list_assets(project_id, "character"),
        "scenes": AssetService.list_assets(project_id, "scene"),
        "props": AssetService.list_assets(project_id, "prop"),
        "images": images,
        "videos": videos,
    }

    # 4. 计算统计（CPU 密集型，放默认线程池）
    stats = await asyncio.to_thread(_build_project_stats, project_id, assets)
    user_costs, unknown_costs = await asyncio.to_thread(_build_project_user_costs, project_id, images, videos)

    # 5. 写快照
    await asyncio.to_thread(write_snapshot, project_id, stats, user_costs, unknown_costs)
    print(f"[STATS SNAPSHOT WRITE] project={project_id[:8]}")

    return {
        "stats": stats,
        "user_costs": user_costs,
        "unknown_cost": unknown_costs["total_cost"],
        "unknown_costs": unknown_costs,
    }


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str = None
    description: str = None
    ai_config: dict = None
    total_episodes: int = None
    minutes_per_episode: float = None
    compute_budget_per_minute: float = None
    project_duration_days: int = None
    rating: Optional[float] = None
    review: Optional[str] = None


async def _get_active_api_key(request: Request) -> Optional[str]:
    """获取当前有效的 API Key。
    SaaS 模式：从 request.state.saas_user 读取（Redis 中的用户信息）。
    selfhosted 模式：从 global.json 读取（原有逻辑）。
    """
    if settings.DEPLOY_MODE == "saas":
        saas_user = getattr(request.state, "saas_user", None)
        return (saas_user or {}).get("api_key")
    auth = get_auth_state()
    return auth.get("api_key") if auth.get("logged_in") else None


@router.post("", response_model=dict)
async def create_project(request: Request, project: ProjectCreate):
    """创建新项目"""
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        raise HTTPException(status_code=403, detail="子账号不能创建项目")
    result = ProjectService.create_project(project.name, project.description)

    # SaaS 模式：将新项目加入用户的项目索引，并写入反向索引
    if settings.DEPLOY_MODE == "saas":
        saas_user = getattr(request.state, "saas_user", None)
        if saas_user:
            from app.services.user_saas_service import add_user_project
            from app.core.redis_client import get_redis
            await add_user_project(saas_user["user_id"], result["project_id"])
            r = await get_redis()
            await r.set(f"project_owner:{result['project_id']}", saas_user["user_id"])

    # 若用户已登录，为新项目创建完整的 createnow 预设结构
    auth_api_key = await _get_active_api_key(request)
    if auth_api_key:
        ai_config = result.get("ai_config", {})
        base_url = settings.CREATENOW_BASE_URL
        now = datetime.now().isoformat()

        config_presets: dict = {"llm": [], "vlm": [], "image": [], "video": [], "tts": []}
        active_preset_ids: dict = {}

        from app.services.createnow_model_config import get_createnow_model_config
        model_config = get_createnow_model_config()
        default_models = model_config.get("default_models", {})

        for svc in ["llm", "vlm", "image", "video", "tts"]:
            preset_id = str(uuid.uuid4())
            default_model = default_models.get(svc) or "nova-pro"
            preset_config: dict = {
                "api_type": "createnow",
                "api_url": base_url,
                "api_key": auth_api_key,
                "model": default_model
            }
            if svc == "tts":
                preset_config["voice"] = ""
            elif svc == "image":
                preset_config["image_edit_model"] = ""
            elif svc == "video":
                preset_config["generate_audio"] = True
                preset_config["multimodal_reference"] = True

            config_presets[svc].append({
                "id": preset_id,
                "name": "CreateNow",
                "config": preset_config,
                "created_at": now
            })
            active_preset_ids[svc] = preset_id

            # 同步到直接服务配置（供 get_ai_service 使用）
            if svc not in ai_config:
                ai_config[svc] = {}
            ai_config[svc]["api_type"] = "createnow"
            ai_config[svc]["api_url"] = base_url
            ai_config[svc]["api_key"] = auth_api_key
            ai_config[svc]["model"] = default_model
            if svc == "video":
                ai_config[svc]["generate_audio"] = True
                ai_config[svc]["multimodal_reference"] = True

        ai_config["config_presets"] = config_presets
        ai_config["active_preset_ids"] = active_preset_ids

        ProjectService.update_project(result["project_id"], ai_config=ai_config)
        result["ai_config"] = ai_config

    return result


@router.get("")
async def list_projects(request: Request, include_stats: bool = Query(False)):
    """列出所有项目"""
    # SaaS 模式：只列出当前用户的项目
    if settings.DEPLOY_MODE == "saas":
        saas_user = getattr(request.state, "saas_user", None)
        if saas_user:
            from app.services.user_saas_service import get_user_project_ids
            project_ids = await get_user_project_ids(saas_user["user_id"])
            all_projects = await asyncio.to_thread(ProjectService.list_projects)
            projects = [p for p in all_projects if p.get("project_id") in set(project_ids)]
            if include_stats:
                for p in projects:
                    p["stats"] = await asyncio.to_thread(_build_project_stats, p["project_id"])
                return {
                    "projects": projects,
                    "user_summary": _build_user_cost_summary(projects),
                }
            return projects
        return []

    projects = await asyncio.to_thread(ProjectService.list_projects)
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        user = get_user_by_username(admin_user["sub"])
        allowed = set(user.get("assigned_project_ids") or []) if user else set()
        projects = [p for p in projects if p.get("project_id") in allowed]

    if include_stats:
        global _homepage_load_total, _homepage_load_done
        _homepage_load_total = len(projects)
        _homepage_load_done = 0

        semaphore = asyncio.Semaphore(PROJECT_HOME_STATS_CONCURRENCY)

        async def _load_project_stats(project: dict) -> dict:
            global _homepage_load_done
            async with semaphore:
                result = await _get_project_home_stats_async(project["project_id"])
                _homepage_load_done += 1
                return result

        project_costs = await asyncio.gather(*[_load_project_stats(p) for p in projects])
        for p, item in zip(projects, project_costs):
            p["stats"] = item.get("stats")
            p["user_costs"] = item.get("user_costs") or {}
            p["unknown_costs"] = item.get("unknown_costs") or {}
        return {
            "projects": projects,
            "user_summary": _build_user_cost_summary_from_project_costs(project_costs),
        }

    return projects


@router.get("/loading-progress")
async def get_homepage_loading_progress():
    """查询主页项目统计加载进度"""
    nonlocal_total = _homepage_load_total
    nonlocal_done = _homepage_load_done
    ready = nonlocal_done >= nonlocal_total and nonlocal_total > 0
    return {
        "ready": ready,
        "total_projects": nonlocal_total,
        "projects_loaded": nonlocal_done,
        "progress_pct": round(nonlocal_done / nonlocal_total * 100) if nonlocal_total else 0,
    }


@router.get("/{project_id}", response_model=dict)
async def get_project(project_id: str):
    """获取项目详情"""
    result = await asyncio.to_thread(ProjectService.get_project, project_id)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.post("/{project_id}/export-assets")
async def export_project_assets(project_id: str, request: Request):
    """导出项目资产到当前 data/output/assets 目录（仅管理员）"""
    admin_user = getattr(request.state, "admin_user", None)
    if not admin_user or admin_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可导出资产")

    from app.services.project_asset_export_service import ProjectAssetExportService

    try:
        return ProjectAssetExportService.export_project_assets(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出资产失败: {e}")


@router.put("/{project_id}", response_model=dict)
async def update_project(project_id: str, project: ProjectUpdate):
    """更新项目"""
    update_data = {}
    if project.name is not None:
        update_data["name"] = project.name
    if project.description is not None:
        update_data["description"] = project.description
    if project.ai_config is not None:
        update_data["ai_config"] = project.ai_config
    for field in ["total_episodes", "minutes_per_episode", "compute_budget_per_minute", "project_duration_days", "rating", "review"]:
        val = getattr(project, field)
        if val is not None:
            update_data[field] = val

    result = ProjectService.update_project(project_id, **update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    from app.services.project_stats_snapshot_service import delete_snapshot
    delete_snapshot(project_id)
    return result


@router.get("/{project_id}/stats")
async def get_project_stats(project_id: str):
    """获取项目统计数据"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return await asyncio.to_thread(_build_project_stats, project_id)


@router.get("/{project_id}/cost-daily")
async def get_project_daily_costs(project_id: str):
    """获取项目按日期聚合的图片/视频消耗"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return await asyncio.to_thread(_build_project_daily_costs, project_id)


@router.get("/{project_id}/cost-breakdown")
async def get_project_cost_breakdown(project_id: str):
    """获取项目消耗看板的日期/集聚合数据"""
    project_dir = _get_projects_dir() / project_id
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return await asyncio.to_thread(_build_project_cost_breakdown, project_id)


@router.delete("/{project_id}")
async def delete_project(request: Request, project_id: str):
    """删除项目"""
    admin_user = getattr(request.state, "admin_user", None)
    if admin_user and admin_user.get("role") == "user":
        raise HTTPException(status_code=403, detail="子账号不能删除项目")
    success = ProjectService.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


class SetBudgetRequest(BaseModel):
    budget_total: Optional[float] = None  # None = 移除预算限制


@router.put("/{project_id}/budget", response_model=dict)
async def set_project_budget(project_id: str, body: SetBudgetRequest, request: Request):
    """设置项目总预算（仅管理员）"""
    admin_user = getattr(request.state, "admin_user", None)
    if not admin_user or admin_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可设置项目预算")

    result = ProjectService.update_project(project_id, budget_total=body.budget_total)
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.get("/stats/by-user")
async def get_stats_by_user():
    """按用户汇总所有项目的实际消耗（基于 created_by 字段，优先 actual_cost）"""
    return await asyncio.to_thread(_sync_get_stats_by_user)


def _sync_get_stats_by_user():
    """同步版本：遍历所有项目目录计算用户消耗"""
    import json as _json
    projects_dir = _get_projects_dir()
    user_costs: dict[str, dict] = {}  # username -> {image_cost, video_cost, total_cost}

    if not projects_dir.exists():
        return {"users": [], "unknown_cost": 0}

    for project_dir in sorted(projects_dir.iterdir()):
        if not project_dir.is_dir():
            continue

        # 扫描图片记录
        images_dir = project_dir / "images"
        if images_dir.exists():
            for img_file in images_dir.glob("*.json"):
                try:
                    img = _json.loads(img_file.read_text(encoding="utf-8"))
                except Exception:
                    continue
                username = (img.get("created_by") or "").strip() or "__unknown__"
                cost = get_image_cost(img)
                entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
                entry["image_cost"] += cost
                entry["total_cost"] += cost

        # 扫描视频记录（所有状态都计入，平台在提交任务时已扣积分）
        videos_dir = project_dir / "videos"
        if videos_dir.exists():
            for vf in videos_dir.glob("*.json"):
                try:
                    v = _json.loads(vf.read_text(encoding="utf-8"))
                except Exception:
                    continue
                username = (v.get("created_by") or "").strip() or "__unknown__"
                cost = get_video_cost(v)
                entry = user_costs.setdefault(username, {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
                entry["video_cost"] += cost
                entry["total_cost"] += cost

    unknown = user_costs.pop("__unknown__", {"image_cost": 0.0, "video_cost": 0.0, "total_cost": 0.0})
    users = [
        {"username": uname, **costs}
        for uname, costs in sorted(user_costs.items(), key=lambda x: x[1]["total_cost"], reverse=True)
    ]

    return {
        "users": users,
        "unknown_cost": round(unknown["total_cost"], 2),
    }


# 主页加载进度追踪
_homepage_load_total: int = 0
_homepage_load_done: int = 0


@router.get("/{project_id}/loading-status")
async def get_project_loading_status(project_id: str):
    """查询项目数据加载进度（前端显示进度条）—— 首次访问时触发预加载"""
    from app.services.asset_service import _assets_cache, _images_cache
    ALL_TYPES = ("character", "scene", "prop", "episode", "storyboard")
    project_cache = _assets_cache.get(project_id, {})
    loaded = [t for t in ALL_TYPES if t in project_cache]
    pending = [t for t in ALL_TYPES if t not in project_cache]
    images_loaded = project_id in _images_cache
    ready = len(pending) == 0 and images_loaded

    # 缓存冷启动时，触发后台预加载（fire-and-forget）
    # 后续的 asset 请求会在 _get_images_cache 的锁上排队等待，而非同时读盘
    if not ready:
        asyncio.create_task(_ensure_project_loaded(project_id))

    total_steps = len(ALL_TYPES) + 1  # 5 assets + images
    done_steps = len(loaded) + (1 if images_loaded else 0)
    return {
        "ready": ready,
        "loaded": loaded,
        "pending": pending,
        "total_assets": len(ALL_TYPES),
        "images_loaded": images_loaded,
        "progress_pct": round(done_steps / total_steps * 100) if total_steps else 0,
    }
