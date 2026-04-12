"""
全局默认提示词服务

JSON 是唯一数据源，无硬编码内容常量。
添加/删除/修改提示词只需编辑 backend/app/prompts/{key}/{preset}.md。

出厂默认（用于全局重置）：backend/app/default_prompt_templates.json + backend/app/prompts/
用户工作副本（可编辑）：backend/config/default_prompt_templates.json
"""
import json
from typing import Dict, Any, Optional
from pathlib import Path

_cache: Optional[Dict] = None

# backend/ 目录（global_prompt_service.py 上两级）
_BACKEND_DIR = Path(__file__).parent.parent.parent

# 出厂默认 JSON（随代码发布，跟踪于 git，仅用于 reset_to_defaults）
_BUILTIN_JSON_PATH = Path(__file__).parent.parent / "default_prompt_templates.json"

# 提示词内容文件目录（.md 文件）
_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _get_json_path() -> Path:
    return _BACKEND_DIR / "config" / "default_prompt_templates.json"


def _resolve_content_files(data: Dict[str, Any]) -> None:
    """就地解析所有 content_file 引用，将内容读入 preset["content"]

    content_file 存在时始终从 .md 文件读取，忽略 JSON 中的 inline content。
    这确保 .md 文件是唯一内容源，避免 JSON inline 与 .md 不同步的问题。
    """
    for key, entry in data.items():
        for preset_name, preset in entry.get("presets", {}).items():
            if isinstance(preset, dict) and "content_file" in preset:
                fpath = _PROMPTS_DIR / preset["content_file"]
                preset["content"] = fpath.read_text(encoding="utf-8") if fpath.exists() else ""


def load_prompts() -> Dict[str, Any]:
    """读取全局提示词（优先用户工作副本，回退出厂默认）"""
    global _cache
    if _cache is not None:
        return _cache
    path = _get_json_path()
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            _cache = json.load(f)
    elif _BUILTIN_JSON_PATH.exists():
        with open(_BUILTIN_JSON_PATH, "r", encoding="utf-8") as f:
            _cache = json.load(f)
    else:
        _cache = {}
    _resolve_content_files(_cache)
    return _cache


def save_prompts(data: Dict[str, Any]) -> None:
    """保存全局提示词到用户工作副本"""
    global _cache
    path = _get_json_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    _cache = data


def invalidate_cache() -> None:
    global _cache
    _cache = None


def get_prompt_content(key: str, ai_config: dict = None) -> str:
    """
    获取提示词内容。

    优先级：项目级自定义 > 项目级激活预设 > 全局 JSON default 预设

    若项目覆盖中存在 custom_suffix，则在基础内容末尾追加自定义指令段。

    Args:
        key: 提示词 key（如 "image", "character_analysis"）
        ai_config: 项目 AI 配置，含 prompt_overrides。为 None 时仅返回全局默认。
    """
    prompts = load_prompts()
    if key not in prompts:
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
                # 激活的是某个全局 preset
                presets = prompts[key].get("presets", {})
                if active in presets:
                    base_content = presets[active].get("content", "")

            # 追加 custom_suffix（若存在）
            custom_suffix = override.get("custom_suffix", "").strip()
            if custom_suffix:
                if not base_content:
                    # 若尚未从 custom 或 preset 取到内容，回退到全局默认
                    presets = prompts[key].get("presets", {})
                    base_content = presets.get("default", {}).get("content", "")
                return base_content + "\n\n---\n[项目自定义附加指令（最高优先级，严格遵守）]\n" + custom_suffix

            if base_content:
                return base_content

    # 全局默认（default preset）
    presets = prompts[key].get("presets", {})
    return presets.get("default", {}).get("content", "")


def reset_to_defaults() -> Dict[str, Any]:
    """将用户工作副本重置为出厂默认 JSON"""
    if not _BUILTIN_JSON_PATH.exists():
        # 出厂文件不存在时返回当前值（不做任何修改）
        return load_prompts()
    with open(_BUILTIN_JSON_PATH, "r", encoding="utf-8") as f:
        defaults = json.load(f)
    _resolve_content_files(defaults)
    save_prompts(defaults)
    return defaults


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


# ── 旧接口（GlobalPromptPanel 和 global_prompts.py 过渡期使用）──────────────────
# 新的 GlobalPromptPanel 直接使用 load_prompts() / save_prompts()，不再用这两个函数。
# 保留以防其他地方有调用。

def load_global_prompts() -> Dict[str, Any]:
    """向后兼容：返回旧的三分组格式"""
    prompts = load_prompts()
    group_a, group_b, group_c = {}, {}, {}
    for key, data in prompts.items():
        cat = data.get("category", "")
        presets = data.get("presets", {})
        if cat == "生成模板":
            group_a[key] = presets
        elif cat == "服务提示词":
            group_b[key] = presets.get("default", {}).get("content", "")
        elif cat == "系统提示词":
            group_c[key] = presets.get("default", {}).get("content", "")
    return {
        "group_a_presets": group_a,
        "group_b_service": group_b,
        "group_c_inline": group_c,
    }


def save_global_prompts(data: Dict[str, Any]) -> None:
    """向后兼容：接受旧的三分组格式并合并保存"""
    prompts = load_prompts()
    # 合并 group_a_presets
    for key, presets in data.get("group_a_presets", {}).items():
        if key in prompts:
            prompts[key]["presets"] = presets
    # 合并 group_b_service（单字符串 → default preset content）
    # 同样跳过有 content_file 的 preset，防止固化已解析内容
    for key, content in data.get("group_b_service", {}).items():
        if key in prompts and isinstance(content, str):
            default_preset = prompts[key]["presets"].get("default", {})
            if "content_file" not in default_preset:
                default_preset["content"] = content
    # 合并 group_c_inline
    # 注意：如果 preset 有 content_file，则 .md 文件是权威来源，不写 inline content，
    # 防止每次保存把已解析的内容固化为 JSON 字段，永久屏蔽 .md 文件的更新。
    for key, content in data.get("group_c_inline", {}).items():
        if key in prompts and isinstance(content, str):
            default_preset = prompts[key]["presets"].get("default", {})
            if "content_file" not in default_preset:
                default_preset["content"] = content
    save_prompts(prompts)
