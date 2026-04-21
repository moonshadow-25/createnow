"""全剧本导入服务 — 分集 / 资产提取 / 串行流式分集并提取"""
import json
import re
import uuid
import logging
from typing import Dict, List, Any, AsyncIterator, Callable, Awaitable, Optional
from datetime import datetime

from app.services.ai_service import get_ai_service
from app.services.asset_service import AssetService
from app.services.global_prompt_service import get_prompt_content

logger = logging.getLogger(__name__)


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _safe_format(template: str, **kwargs) -> str:
    """安全替换模板变量，不会因模板中含 { } 的 JSON 示例而抛出 KeyError。"""
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _extract_json(text: str) -> Dict:
    """从 LLM 输出中提取 JSON 对象"""
    text = (text or "").strip()
    if not text:
        return {}

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    block = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if block:
        try:
            return json.loads(block.group(1))
        except json.JSONDecodeError:
            pass

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
    normalized = name.strip().lower()
    for asset in existing:
        if asset.get("name", "").strip().lower() == normalized:
            return True
    return False


def _build_existing_assets_summary(project_id: str) -> str:
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


async def _chat_json_streaming(
    llm,
    *,
    messages: List[Dict[str, Any]],
    system_prompt: str,
    max_tokens: int,
    on_progress: Optional[Callable[[int], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """使用流式 chat 收集 JSON，期间通过 on_progress 回调回传进度心跳。"""
    parts: List[str] = []
    chunk_count = 0

    async for evt in llm.chat_stream(
        messages=messages,
        system_prompt=system_prompt,
        temperature=0.1,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    ):
        evt_type = evt.get("type")
        if evt_type == "error":
            raise RuntimeError(evt.get("content") or "LLM 流式调用失败")
        if evt_type == "content":
            parts.append(evt.get("content", ""))
            chunk_count += 1
            if on_progress and chunk_count % 20 == 0:
                await on_progress(chunk_count)
        elif evt_type == "content_end" and not parts:
            parts.append(evt.get("content", ""))

    raw = "".join(parts)
    parsed = _extract_json(raw)
    if not parsed:
        raise RuntimeError("AI 返回结果无法解析")
    return parsed


def _apply_split_parsed(project_id: str, parsed: Dict[str, Any]) -> Dict[str, Any]:
    if "episodes" not in parsed:
        raise RuntimeError("AI 分集结果缺少 episodes 字段")

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

    for ep_data in parsed.get("episodes", []) or []:
        ep_number = ep_data.get("episode_number", len(result_episodes) + 1)
        ep_title = ep_data.get("title", f"第{ep_number}集")
        ep_content = ep_data.get("content", "")

        if ep_number in existing_by_number:
            existing_ep = existing_by_number[ep_number]
            existing_ep["script"] = ep_content
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
            new_episode = {
                "asset_id": str(uuid.uuid4()),
                "name": ep_title,
                "episode_number": ep_number,
                "script": ep_content,
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


def _apply_extract_parsed(project_id: str, parsed: Dict[str, Any]) -> Dict[str, Any]:
    existing_characters = AssetService.list_assets(project_id, "character")
    existing_scenes = AssetService.list_assets(project_id, "scene")
    existing_props = AssetService.list_assets(project_id, "prop")

    created = {"characters": [], "scenes": [], "props": []}
    skipped_count = 0
    now = datetime.now().isoformat()

    for char in parsed.get("characters", []) or []:
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

    for scene in parsed.get("scenes", []) or []:
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

    for prop in parsed.get("props", []) or []:
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


# ── 原同步接口（兼容） ─────────────────────────────────────────────────────────

async def split_into_episodes(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    llm = get_ai_service(ai_config, "llm", project_id)
    system_prompt = get_prompt_content("full_script_split", ai_config)

    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请将以下完整剧本进行分集：\n\n{content}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=64000,
        )
        if response.get("error"):
            raise RuntimeError(response.get("error"))
        parsed = _extract_json(response.get("content", ""))
        if not parsed:
            raise RuntimeError("AI 返回结果无法解析，请重试")
        return _apply_split_parsed(project_id, parsed)
    except Exception as e:
        logger.error(f"[FullScriptService] split LLM call failed: {e}")
        raise RuntimeError(f"AI 分集失败：{e}")
    finally:
        await llm.close()


async def extract_all_assets(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    llm = get_ai_service(ai_config, "llm", project_id)
    existing_summary = _build_existing_assets_summary(project_id)
    template = get_prompt_content("full_script_extract", ai_config)
    system_prompt = _safe_format(template, existing_assets_summary=existing_summary)

    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请从以下完整剧本中提取所有资产：\n\n{content}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=32000,
        )
        if response.get("error"):
            raise RuntimeError(response.get("error"))
        parsed = _extract_json(response.get("content", ""))
        if not parsed:
            raise RuntimeError("AI 返回结果无法解析，请重试")
        return _apply_extract_parsed(project_id, parsed)
    except Exception as e:
        logger.error(f"[FullScriptService] extract LLM call failed: {e}")
        raise RuntimeError(f"AI 资产提取失败：{e}")
    finally:
        await llm.close()


async def split_and_extract(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    split_result = await split_into_episodes(project_id, content, ai_config)
    extract_result = await extract_all_assets(project_id, content, ai_config)
    return {
        "split": split_result,
        "extract": extract_result,
    }


# ── 新增：流式接口（用于前端分段反馈） ─────────────────────────────────────────

async def stream_split_and_extract(
    project_id: str,
    content: str,
    ai_config: Dict,
) -> AsyncIterator[Dict[str, Any]]:
    llm = get_ai_service(ai_config, "llm", project_id)
    try:
        yield {"type": "status", "stage": "prepare", "content": "已创建处理任务，开始分集..."}

        split_prompt = get_prompt_content("full_script_split", ai_config)
        split_parts: List[str] = []
        split_chunks = 0
        async for evt in llm.chat_stream(
            messages=[{"role": "user", "content": f"请将以下完整剧本进行分集：\n\n{content}"}],
            system_prompt=split_prompt,
            temperature=0.1,
            max_tokens=64000,
        ):
            evt_type = evt.get("type")
            if evt_type == "error":
                raise RuntimeError(evt.get("content") or "分集模型调用失败")
            if evt_type == "content":
                split_parts.append(evt.get("content", ""))
                split_chunks += 1
                if split_chunks % 20 == 0:
                    yield {
                        "type": "status",
                        "stage": "split",
                        "content": f"分集中...（已接收模型输出片段 {split_chunks}）",
                    }
            elif evt_type == "content_end" and not split_parts:
                split_parts.append(evt.get("content", ""))

        split_parsed = _extract_json("".join(split_parts))
        if not split_parsed:
            raise RuntimeError("分集结果无法解析为JSON")

        split_result = _apply_split_parsed(project_id, split_parsed)
        yield {"type": "split_done", "split": split_result}
        yield {"type": "status", "stage": "extract", "content": "分集完成，开始提取资产..."}

        existing_summary = _build_existing_assets_summary(project_id)
        extract_template = get_prompt_content("full_script_extract", ai_config)
        extract_prompt = _safe_format(extract_template, existing_assets_summary=existing_summary)

        extract_parts: List[str] = []
        extract_chunks = 0
        async for evt in llm.chat_stream(
            messages=[{"role": "user", "content": f"请从以下完整剧本中提取所有资产：\n\n{content}"}],
            system_prompt=extract_prompt,
            temperature=0.1,
            max_tokens=32000,
        ):
            evt_type = evt.get("type")
            if evt_type == "error":
                raise RuntimeError(evt.get("content") or "资产提取模型调用失败")
            if evt_type == "content":
                extract_parts.append(evt.get("content", ""))
                extract_chunks += 1
                if extract_chunks % 20 == 0:
                    yield {
                        "type": "status",
                        "stage": "extract",
                        "content": f"资产提取中...（已接收模型输出片段 {extract_chunks}）",
                    }
            elif evt_type == "content_end" and not extract_parts:
                extract_parts.append(evt.get("content", ""))

        extract_parsed = _extract_json("".join(extract_parts))
        if not extract_parsed:
            raise RuntimeError("资产提取结果无法解析为JSON")

        extract_result = _apply_extract_parsed(project_id, extract_parsed)
        yield {"type": "extract_done", "extract": extract_result}
        yield {
            "type": "done",
            "split": split_result,
            "extract": extract_result,
        }
    except Exception as e:
        logger.error(f"[FullScriptService] stream split-and-extract failed: {e}")
        yield {"type": "error", "content": f"处理失败：{e}"}
    finally:
        await llm.close()
