"""
Generation API - 工具函数
"""

from fastapi import HTTPException
from app.core.context import get_current_data_root


VIDEO_RESOLUTION_PRICES = {
    "480p": 0.7,
    "720p": 1.0,
    "1080p": 2.8,
}

LEGACY_RESOLUTION_MAP = {
    "854x480": "480p",
    "1280x720": "720p",
    "720x1280": "720p",
    "21:9-720p": "720p",
    "1920x1080": "1080p",
}


def normalize_video_resolution(resolution: str | None) -> str:
    if not resolution:
        return "720p"
    value = str(resolution).strip().lower()
    if value in VIDEO_RESOLUTION_PRICES:
        return value
    if value in LEGACY_RESOLUTION_MAP:
        return LEGACY_RESOLUTION_MAP[value]

    if "x" in value:
        try:
            w_str, h_str = value.split("x", 1)
            w = int(float(w_str.strip()))
            h = int(float(h_str.strip()))
            short_side = min(w, h)
            if short_side >= 1080:
                return "1080p"
            if short_side >= 720:
                return "720p"
            return "480p"
        except (ValueError, TypeError):
            pass

    return "720p"


def get_video_unit_price(resolution: str | None) -> float:
    return VIDEO_RESOLUTION_PRICES[normalize_video_resolution(resolution)]


def calc_video_compute_units(duration: float, resolution: str | None) -> float:
    return float(duration or 0) * get_video_unit_price(resolution)


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


def check_project_budget(project: dict) -> None:
    """检查项目预算，超出时抛出 HTTP 402（实时扫描文件计算开销）"""
    budget_total = project.get("budget_total")
    if budget_total is None:
        return

    import json as _json
    project_id = project.get("project_id")
    project_dir = _get_projects_dir() / project_id

    images_dir = project_dir / "images"
    total_images = len(list(images_dir.glob("*.json"))) if images_dir.exists() else 0

    videos_dir = project_dir / "videos"
    total_video_cost = 0.0
    if videos_dir.exists():
        for vf in videos_dir.glob("*.json"):
            with open(vf, encoding="utf-8") as f:
                v = _json.load(f)
            if v.get("status") == "completed":
                total_video_cost += calc_video_compute_units(
                    v.get("duration") or 0,
                    v.get("resolution")
                )

    budget_spent = round(0.4 * total_images + total_video_cost, 2)
    if budget_spent >= budget_total:
        raise HTTPException(
            status_code=402,
            detail=f"项目预算已超出（已用 {budget_spent:.2f} / 总额 {budget_total:.2f}），请联系管理员增加预算"
        )


def parse_size(size_str: str) -> tuple[int, int]:
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
            # 特殊比例映射
            ratio_key = f"{int(w_ratio)}:{int(h_ratio)}"
            special_ratios = {
                "6:19": (576, 1824),   # 三宫格竖图
                "19:6": (1824, 576),   # 三宫格横图
            }
            if ratio_key in special_ratios:
                return special_ratios[ratio_key]

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
