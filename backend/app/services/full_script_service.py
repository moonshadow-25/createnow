"""全剧本导入服务 — 分集 / 资产提取 / 两者并发"""
import json
import re
import uuid
import asyncio
import logging
from typing import Dict, List, Any
from datetime import datetime

from app.services.ai_service import get_ai_service
from app.services.asset_service import AssetService, ProjectService
from app.services.global_prompt_service import get_prompt_content

logger = logging.getLogger(__name__)


# ── 工具函数（复用 storyboard_asset_service 的模式）──────────────────────────

def _safe_format(template: str, **kwargs) -> str:
    """安全替换模板变量，不会因模板中含 { } 的 JSON 示例而抛出 KeyError。"""
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _extract_json(text: str) -> Dict:
    """从 LLM 输出中提取 JSON 对象"""
    text = text.strip()
    # 直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 提取 ```json ... ``` 代码块
    block = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if block:
        try:
            return json.loads(block.group(1))
        except json.JSONDecodeError:
            pass
    # 提取第一个 { ... }
    start = text.find("{")
    if start != -1:
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start: i + 1])
                    except json.JSONDecodeError:
                        break
    return {}


def _is_duplicate(name: str, existing: List[Dict]) -> bool:
    """简单名称去重：忽略大小写和空格"""
    normalized = name.strip().lower()
    for asset in existing:
        if asset.get("name", "").strip().lower() == normalized:
            return True
    return False


def _build_existing_assets_summary(project_id: str) -> str:
    """构建现有资产摘要文本（角色/场景/道具名称列表）"""
    existing_characters = AssetService.list_assets(project_id, "character")
    existing_scenes = AssetService.list_assets(project_id, "scene")
    existing_props = AssetService.list_assets(project_id, "prop")

    parts = []
    if existing_characters:
        names = "、".join(c["name"] for c in existing_characters)
        parts.append(f"角色：{names}")
    if existing_scenes:
        names = "、".join(s["name"] for s in existing_scenes)
        parts.append(f"场景：{names}")
    if existing_props:
        names = "、".join(p["name"] for p in existing_props)
        parts.append(f"道具：{names}")

    return "\n".join(parts) if parts else "（暂无已有资产）"


# ── 分集 ──────────────────────────────────────────────────────────────────────

async def split_into_episodes(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    """
    使用 AI 将全剧本文本分集，创建或更新 Episode 资产。

    Returns:
        {
            "episodes_created": N,
            "episodes_updated": N,
            "total_episodes": N,
            "episodes": [{ "episode_number": 1, "title": "...", "is_new": True/False }]
        }
    """
    llm = get_ai_service(ai_config, "llm", project_id)
    system_prompt = get_prompt_content("full_script_split", ai_config)

    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请将以下完整剧本进行分集：\n\n{content}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=64000,
        )
        raw = response.get("content", "")
    except Exception as e:
        logger.error(f"[FullScriptService] split LLM call failed: {e}")
        raise RuntimeError(f"AI 分集失败：{e}")

    parsed = _extract_json(raw)
    if not parsed or "episodes" not in parsed:
        logger.error(f"[FullScriptService] Could not parse split result: {raw[:300]}")
        raise RuntimeError("AI 返回结果无法解析，请重试")

    # 加载现有 episodes
    existing_episodes = AssetService.list_assets(project_id, "episode")
    existing_by_number = {}
    for ep in existing_episodes:
        ep_num = ep.get("episode_number")
        if ep_num is not None:
            existing_by_number[ep_num] = ep

    episodes_created = 0
    episodes_updated = 0
    result_episodes = []
    now = datetime.now().isoformat()

    for ep_data in parsed.get("episodes", []):
        ep_number = ep_data.get("episode_number", len(result_episodes) + 1)
        ep_title = ep_data.get("title", f"第{ep_number}集")
        ep_content = ep_data.get("content", "")

        if ep_number in existing_by_number:
            # 更新现有集的 script_content
            existing_ep = existing_by_number[ep_number]
            existing_ep["script_content"] = ep_content
            if ep_title:
                existing_ep["name"] = ep_title
            AssetService.save_asset(project_id, "episode", existing_ep)
            episodes_updated += 1
            result_episodes.append({
                "episode_number": ep_number,
                "title": ep_title,
                "is_new": False,
            })
        else:
            # 创建新 Episode
            new_episode = {
                "asset_id": str(uuid.uuid4()),
                "name": ep_title,
                "episode_number": ep_number,
                "script_content": ep_content,
                "created_at": now,
            }
            AssetService.save_asset(project_id, "episode", new_episode)
            episodes_created += 1
            result_episodes.append({
                "episode_number": ep_number,
                "title": ep_title,
                "is_new": True,
            })

    return {
        "episodes_created": episodes_created,
        "episodes_updated": episodes_updated,
        "total_episodes": len(result_episodes),
        "episodes": result_episodes,
    }


# ── 资产提取 ──────────────────────────────────────────────────────────────────

async def extract_all_assets(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    """
    使用 AI 从全剧本文本中提取角色/场景/道具。

    Prompt 中包含现有资产列表，让 AI 跳过已有资产。
    代码层面的同名去重只是最终保底。

    Returns:
        {
            "created": { "characters": [...], "scenes": [...], "props": [...] },
            "skipped_count": N,
            "total_created": N,
        }
    """
    llm = get_ai_service(ai_config, "llm", project_id)

    # 构建现有资产摘要（注入 prompt）
    existing_summary = _build_existing_assets_summary(project_id)

    # 获取 prompt 并填充现有资产
    template = get_prompt_content("full_script_extract", ai_config)
    system_prompt = _safe_format(template, existing_assets_summary=existing_summary)

    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请从以下完整剧本中提取所有资产：\n\n{content}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=32000,
        )
        raw = response.get("content", "")
    except Exception as e:
        logger.error(f"[FullScriptService] extract LLM call failed: {e}")
        raise RuntimeError(f"AI 资产提取失败：{e}")

    parsed = _extract_json(raw)
    if not parsed:
        logger.error(f"[FullScriptService] Could not parse extract result: {raw[:300]}")
        raise RuntimeError("AI 返回结果无法解析，请重试")

    # 创建资产（代码层保底去重）
    existing_characters = AssetService.list_assets(project_id, "character")
    existing_scenes = AssetService.list_assets(project_id, "scene")
    existing_props = AssetService.list_assets(project_id, "prop")

    created = {"characters": [], "scenes": [], "props": []}
    skipped_count = 0
    now = datetime.now().isoformat()

    # 角色
    for char in parsed.get("characters", []):
        name = (char.get("name") or "").strip()
        if not name:
            continue
        if _is_duplicate(name, existing_characters):
            skipped_count += 1
            continue
        new_asset = {
            "asset_id": str(uuid.uuid4()),
            "name": name,
            "description": char.get("description", ""),
            "gender": char.get("gender", ""),
            "age": char.get("age", ""),
            "created_at": now,
        }
        saved = AssetService.save_asset(project_id, "character", new_asset)
        created["characters"].append(saved)
        existing_characters.append(saved)

    # 场景
    for scene in parsed.get("scenes", []):
        name = (scene.get("name") or "").strip()
        if not name:
            continue
        if _is_duplicate(name, existing_scenes):
            skipped_count += 1
            continue
        new_asset = {
            "asset_id": str(uuid.uuid4()),
            "name": name,
            "description": scene.get("description", ""),
            "time_of_day": scene.get("time_of_day", ""),
            "created_at": now,
        }
        saved = AssetService.save_asset(project_id, "scene", new_asset)
        created["scenes"].append(saved)
        existing_scenes.append(saved)

    # 道具
    for prop in parsed.get("props", []):
        name = (prop.get("name") or "").strip()
        if not name:
            continue
        if _is_duplicate(name, existing_props):
            skipped_count += 1
            continue
        new_asset = {
            "asset_id": str(uuid.uuid4()),
            "name": name,
            "description": prop.get("description", ""),
            "created_at": now,
        }
        saved = AssetService.save_asset(project_id, "prop", new_asset)
        created["props"].append(saved)
        existing_props.append(saved)

    total_created = len(created["characters"]) + len(created["scenes"]) + len(created["props"])

    return {
        "created": created,
        "skipped_count": skipped_count,
        "total_created": total_created,
    }


# ── 分集 + 提取 并发 ─────────────────────────────────────────────────────────

async def split_and_extract(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    """
    并发执行分集和资产提取。

    Returns:
        {
            "split": { ... },   # split_into_episodes 的结果
            "extract": { ... }, # extract_all_assets 的结果
        }
    """
    split_result, extract_result = await asyncio.gather(
        split_into_episodes(project_id, content, ai_config),
        extract_all_assets(project_id, content, ai_config),
    )

    return {
        "split": split_result,
        "extract": extract_result,
    }
