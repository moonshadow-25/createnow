"""视频轮询失败退款辅助函数。"""

from datetime import datetime, timedelta
from typing import Any, Optional


VIDEO_REFUND_WINDOW_HOURS = 24


def init_video_billing_fields(record: dict[str, Any], now_iso: Optional[str] = None) -> None:
    """初始化轮询类视频的计费与退款字段。"""
    billing_started_at = now_iso or record.get("created_at") or datetime.now().isoformat()
    record.setdefault("billing_started_at", billing_started_at)
    record.setdefault("refund_window_hours", VIDEO_REFUND_WINDOW_HOURS)
    record.setdefault("refund_status", "none")
    record.setdefault("billing_status", "charged")


def _parse_record_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _normalize_for_compare(value: datetime, now: datetime) -> datetime:
    if value.tzinfo is None and now.tzinfo is not None:
        return value.replace(tzinfo=now.tzinfo)
    if value.tzinfo is not None and now.tzinfo is None:
        return value.replace(tzinfo=None)
    return value


def _is_within_refund_window(video_record: dict[str, Any], now: datetime) -> bool:
    started_at = _parse_record_time(video_record.get("billing_started_at") or video_record.get("created_at"))
    if not started_at:
        return False
    started_at = _normalize_for_compare(started_at, now)
    return timedelta(0) <= now - started_at <= timedelta(hours=VIDEO_REFUND_WINDOW_HOURS)


def _preserve_original_costs(video_record: dict[str, Any]) -> None:
    cost_fields = ("credits_consumed", "actual_cost", "estimated_cost")
    for field in cost_fields:
        original_field = f"original_{field}"
        if original_field not in video_record:
            video_record[original_field] = video_record.get(field)


def apply_video_refund_if_eligible(video_record: dict[str, Any], reason: str) -> None:
    """在最终失败时按 24 小时窗口执行一次性退款标记。"""
    refund_status = video_record.get("refund_status")
    if refund_status in {"refunded", "expired"}:
        return

    now = datetime.now()
    now_iso = now.isoformat()
    video_record.setdefault("refund_window_hours", VIDEO_REFUND_WINDOW_HOURS)

    if _is_within_refund_window(video_record, now):
        _preserve_original_costs(video_record)
        video_record["credits_consumed"] = 0
        video_record["actual_cost"] = 0
        video_record["estimated_cost"] = 0
        video_record["refund_status"] = "refunded"
        video_record["billing_status"] = "refunded"
        video_record["refunded_at"] = now_iso
        video_record["refund_reason"] = f"{reason}_within_24h"
        return

    video_record["refund_status"] = "expired"
    video_record["billing_status"] = "charged"
    video_record["refund_checked_at"] = now_iso
    video_record["refund_reason"] = f"{reason}_after_24h"


def is_transient_poll_failure(raw_result: dict[str, Any]) -> bool:
    """判断轮询失败是否更像临时拉取异常，而不是供应商最终失败。"""
    if raw_result.get("success") is not False:
        return False

    status = raw_result.get("status")
    if status == "poll_failed":
        return True
    if status != "failed":
        return True

    raw_poll_response = raw_result.get("raw_poll_response")
    if isinstance(raw_poll_response, dict):
        raw_status = str(
            raw_poll_response.get("status")
            or raw_poll_response.get("task_status")
            or raw_poll_response.get("state")
            or ""
        ).lower()
        output = raw_poll_response.get("output")
        if isinstance(output, dict):
            raw_status = raw_status or str(output.get("task_status") or output.get("status") or "").lower()
        if raw_status in {"failed", "fail", "error", "canceled", "cancelled"}:
            return False

        # HTTP / 网关层错误没有业务失败状态，按临时轮询异常处理。
        if "status_code" in raw_poll_response and not raw_status:
            return True

    error = str(raw_result.get("error") or "").lower()
    transient_markers = (
        "timeout",
        "connection error",
        "connect error",
        "unexpected error",
        "poll error",
        "轮询失败",
        "network",
    )
    if any(marker in error for marker in transient_markers):
        return True

    return raw_poll_response is None
