"""
全局默认提示词服务

全局提示词是软件发布者维护的出厂默认提示词。
注册表（JSON）：backend/app/default_prompt_templates.json
内容文件（.md）：backend/app/prompts/{key}/{preset}.md

JSON 负责 key、label、category、preset 元信息和 content_file 路径；
带 content_file 的正文保存到 .md，未带 content_file 的 inline content 保存到注册表。
"""
import copy
import json
from pathlib import Path
from typing import Any, Dict, Optional

_cache: Optional[Dict] = None

# 出厂默认 JSON（随代码发布，跟踪于 git）
_BUILTIN_JSON_PATH = Path(__file__).parent.parent / "default_prompt_templates.json"

# 提示词内容文件目录（.md 文件）
_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _read_registry() -> Dict[str, Any]:
    if not _BUILTIN_JSON_PATH.exists():
        return {}
    with open(_BUILTIN_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_registry(data: Dict[str, Any]) -> None:
    _BUILTIN_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_BUILTIN_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _resolve_content_files(data: Dict[str, Any]) -> None:
    """就地解析所有 content_file 引用，将 .md 正文读入 preset["content"]。"""
    for entry in data.values():
        for preset in entry.get("presets", {}).values():
            if isinstance(preset, dict) and "content_file" in preset:
                fpath = _PROMPTS_DIR / preset["content_file"]
                preset["content"] = fpath.read_text(encoding="utf-8") if fpath.exists() else ""


def _write_content_files(data: Dict[str, Any]) -> None:
    """把带 content_file 的 preset 正文写回 .md 文件。"""
    for entry in data.values():
        for preset in entry.get("presets", {}).values():
            if not isinstance(preset, dict):
                continue
            content_file = preset.get("content_file")
            if not content_file or "content" not in preset:
                continue
            fpath = _PROMPTS_DIR / content_file
            fpath.parent.mkdir(parents=True, exist_ok=True)
            fpath.write_text(preset.get("content", ""), encoding="utf-8")


def _registry_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """生成可写入注册表的 payload：content_file 模板不在 JSON 中固化正文。"""
    payload = copy.deepcopy(data)
    for entry in payload.values():
        for preset in entry.get("presets", {}).values():
            if isinstance(preset, dict) and "content_file" in preset:
                preset.pop("content", None)
    return payload


def load_prompts() -> Dict[str, Any]:
    """读取全局提示词（注册表 + .md 正文）。"""
    global _cache
    if _cache is not None:
        return _cache

    _cache = _read_registry()
    _resolve_content_files(_cache)
    return _cache


def save_prompts(data: Dict[str, Any]) -> None:
    """保存全局提示词到发布源文件。"""
    global _cache
    _write_content_files(data)
    _write_registry(_registry_payload(data))
    _cache = data


def invalidate_cache() -> None:
    global _cache
    _cache = None


def get_prompt_content(key: str, ai_config: dict = None) -> str:
    """
    获取提示词内容。

    优先级：项目级自定义 > 项目级激活预设 > 全局默认预设（default → default_ai → 首个可用预设）

    若项目覆盖中存在 custom_suffix，则在基础内容末尾追加自定义指令段。

    Args:
        key: 提示词 key（如 "image", "character_analysis"）
        ai_config: 项目 AI 配置，含 prompt_overrides。为 None 时仅返回全局默认。
    """
    prompts = load_prompts()
    if key not in prompts:
        return ""

    def _pick_default_content(presets: Dict[str, Any]) -> str:
        if not isinstance(presets, dict) or not presets:
            return ""
        for preset_key in ("default", "default_ai"):
            preset = presets.get(preset_key)
            if isinstance(preset, dict):
                content = preset.get("content", "")
                if content:
                    return content
        for preset in presets.values():
            if isinstance(preset, dict):
                content = preset.get("content", "")
                if content:
                    return content
        return ""

    base_content = ""

    # 检查项目级覆盖
    if ai_config:
        overrides = ai_config.get("prompt_overrides", {})
        override = overrides.get(key)
        if isinstance(override, dict):
            active = override.get("active", "default")
            custom = override.get("custom", {})
            if active in custom:
                base_content = custom[active].get("content", "")
            else:
                presets = prompts[key].get("presets", {})
                if active in presets and isinstance(presets.get(active), dict):
                    base_content = presets[active].get("content", "")

            custom_suffix = override.get("custom_suffix", "").strip()
            if custom_suffix:
                if not base_content:
                    presets = prompts[key].get("presets", {})
                    base_content = _pick_default_content(presets)
                return base_content + "\n\n---\n[项目自定义附加指令（最高优先级，严格遵守）]\n" + custom_suffix

            if base_content:
                return base_content

    presets = prompts[key].get("presets", {})
    return _pick_default_content(presets)


# ── 向后兼容的瘦包装（旧调用方无需修改）────────────────────────────────────────

def get_group_b_template(key: str) -> str:
    """获取服务提示词（向后兼容）"""
    return get_prompt_content(key)


def get_group_c_template(key: str) -> str:
    """获取系统提示词（向后兼容）"""
    return get_prompt_content(key)


def get_group_a_presets() -> Dict[str, Any]:
    """返回 {key: presets_dict}，供 template_helpers 使用"""
    prompts = load_prompts()
    return {
        key: data["presets"]
        for key, data in prompts.items()
        if data.get("category") == "生成模板" and "presets" in data
    }
