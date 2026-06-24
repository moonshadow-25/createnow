"""CreateNow 模型标签与新项目默认模型配置。"""
from copy import deepcopy
from typing import Any

from app.services.auth_service import _read_global_config, _write_global_config

SERVICE_TYPES = ("llm", "vlm", "image", "video", "tts")

DEFAULT_CREATENOW_MODEL_CONFIG: dict[str, Any] = {
    "suggestions": {
        "llm": [],
        "vlm": [],
        "image": [
            {"label": "image2", "model": "nova-max"},
            {"label": "nano2", "model": "nova-pro"},
            {"label": "image2备用", "model": "image2-backup"},
        ],
        "video": [
            {"label": "sd2", "model": "nova-pro"},
            {"label": "sd2-fast", "model": "nova"},
            {"label": "happyhorse", "model": "happyhorse-1.0-r2v"},
        ],
        "tts": [],
    },
    "default_models": {
        "llm": "nova-pro",
        "vlm": "nova-pro",
        "image": "nova-pro",
        "video": "nova-pro",
        "tts": "nova-pro",
    },
}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_model_config(raw: Any) -> dict[str, Any]:
    normalized = deepcopy(DEFAULT_CREATENOW_MODEL_CONFIG)
    if not isinstance(raw, dict):
        return normalized

    raw_suggestions = raw.get("suggestions")
    if isinstance(raw_suggestions, dict):
        for service_type in SERVICE_TYPES:
            items = raw_suggestions.get(service_type)
            if not isinstance(items, list):
                continue
            cleaned_items = []
            seen_keys = set()
            for item in items:
                if not isinstance(item, dict):
                    continue
                label = _clean_text(item.get("label"))
                model = _clean_text(item.get("model"))
                if not label or not model:
                    continue
                key = (label, model)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                cleaned_items.append({"label": label, "model": model})
            normalized["suggestions"][service_type] = cleaned_items

    raw_defaults = raw.get("default_models")
    if isinstance(raw_defaults, dict):
        for service_type in SERVICE_TYPES:
            model = _clean_text(raw_defaults.get(service_type))
            if model:
                normalized["default_models"][service_type] = model

    return normalized


def get_createnow_model_config() -> dict[str, Any]:
    cfg = _read_global_config()
    raw = cfg.get("createnow_model_config") if isinstance(cfg, dict) else None
    return normalize_model_config(raw)


def save_createnow_model_config(raw: Any) -> dict[str, Any]:
    normalized = normalize_model_config(raw)
    cfg = _read_global_config()
    if not isinstance(cfg, dict):
        cfg = {}
    cfg["createnow_model_config"] = normalized
    _write_global_config(cfg)
    return normalized


def get_default_createnow_model(service_type: str) -> str:
    config = get_createnow_model_config()
    return config["default_models"].get(service_type) or "nova-pro"
