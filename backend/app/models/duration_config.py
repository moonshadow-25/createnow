"""
分镜时长配置与换算公式

分镜时长上限（storyboard_duration_seconds，默认 15 秒）是可配置变量（4-30 秒），
所有由此派生数值（Shot 段数、对白字数区间、后端校验上限）必须通过本模块的
derive_dialogue_limits() 计算，禁止在调用点散落手写公式。
"""
from typing import Any, Dict, Optional


# 默认每 Shot 时长（秒）——Seedance 2.0 推荐的镜头节奏
_PER_SHOT_SECONDS = 3
# 15 秒基准下的单镜对白字数上限（与历史模板一致）
_BASE_CHARS_MAX = 65
# 15 秒基准时长
_BASE_DURATION = 15


def derive_dialogue_limits(duration_seconds: int) -> Dict[str, int]:
    """根据分镜时长换算 Shot 段数与对白字数约束。

    Args:
        duration_seconds: 分镜时长（秒）

    Returns:
        {
            "shot_count": Shot 段数（3 秒一跳，至少 1 段）,
            "per_shot_seconds": 每段约多少秒,
            "chars_best_low": 对白建议字数下限,
            "chars_best_high": 对白建议字数上限（即配置的 chars_max）,
            "chars_max": 对白字数硬上限（供提示词使用）,
            "chars_validate_max": 后端分段校验的宽松上限,
        }
    """
    s = max(1, int(duration_seconds or 0))
    shot_count = max(1, round(s / _PER_SHOT_SECONDS))
    per_shot_seconds = max(1, round(s / shot_count))
    chars_max = max(1, round(_BASE_CHARS_MAX * s / _BASE_DURATION))
    return {
        "shot_count": shot_count,
        "per_shot_seconds": per_shot_seconds,
        "chars_best_low": max(1, round(chars_max * 0.6)),
        "chars_best_high": chars_max,
        "chars_max": chars_max,
        "chars_validate_max": max(100, round(chars_max * 1.5)),
    }


def render_duration_template(content: str, duration_seconds: int, chars_max: Optional[int] = None) -> str:
    """渲染提示词模板中的时长/字数占位符。

    只替换存在的占位符，模板中未使用的占位符原样保留（自定义模板兼容）。
    占位符列表：{storyboard_duration_seconds} {shot_count} {per_shot_seconds} {per_grid_seconds}
    {dialogue_chars_best_low} {dialogue_chars_best_high} {dialogue_chars_max}
    """
    if not content:
        return content
    limits = derive_dialogue_limits(duration_seconds)
    if chars_max is not None and int(chars_max) >= 1:
        # 用户手动覆盖字数上限时，区间按同比例推导
        cm = int(chars_max)
        limits = {
            **limits,
            "chars_max": cm,
            "chars_best_high": cm,
            "chars_best_low": max(1, round(cm * 0.6)),
            "chars_validate_max": max(100, round(cm * 1.5)),
        }
    values = {
        "storyboard_duration_seconds": str(duration_seconds),
        "shot_count": str(limits["shot_count"]),
        "per_shot_seconds": str(limits["per_shot_seconds"]),
        "per_grid_seconds": f"{duration_seconds / 9:.1f}",
        "dialogue_chars_best_low": str(limits["chars_best_low"]),
        "dialogue_chars_best_high": str(limits["chars_best_high"]),
        "dialogue_chars_max": str(limits["chars_max"]),
    }
    for key, value in values.items():
        content = content.replace("{" + key + "}", value)
    return content


def get_storyboard_duration_config(ai_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """从项目 ai_config 读取归一化后的分镜时长/字数配置。

    Returns:
        {"duration_seconds": int, "dialogue_chars_max": int}
    """
    from app.models.project import normalize_global_style_config

    gs = normalize_global_style_config((ai_config or {}).get("global_style_config"))
    return {
        "duration_seconds": int(gs.get("storyboard_duration_seconds", _BASE_DURATION)),
        "dialogue_chars_max": int(gs.get("dialogue_chars_max", _BASE_CHARS_MAX)),
    }
