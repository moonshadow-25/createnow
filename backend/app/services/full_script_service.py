"""全剧本导入服务 — 分集 / 资产提取 / 分块并发分集并提取"""
import asyncio
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

# 分块参数
CHUNK_SIZE = 10000       # 每块字符数
OVERLAP = 1000            # 块间重叠字符数
SHORT_LIMIT = 10000       # 短于此值走旧版单次 LLM


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
    """构建已有资产摘要文本，供 LLM 去重参考"""
    characters = AssetService.list_assets(project_id, "character")
    scenes = AssetService.list_assets(project_id, "scene")
    props = AssetService.list_assets(project_id, "prop")

    parts = []
    if characters:
        names = "、".join(c["name"] for c in characters)
        parts.append(f"已有角色：{names}")
    if scenes:
        names = "、".join(s["name"] for s in scenes)
        parts.append(f"已有场景：{names}")
    if props:
        names = "、".join(p["name"] for p in props)
        parts.append(f"已有道具：{names}")

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
        ep_title = str(ep_data.get("title") or f"第{ep_number}集").strip() or f"第{ep_number}集"
        ep_content = ep_data.get("content", "")

        if ep_number in existing_by_number:
            existing_ep = existing_by_number[ep_number]
            existing_ep["script"] = ep_content
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


def _apply_episodes_to_project(project_id: str, episodes: List[Dict]) -> Dict[str, Any]:
    """将切片得到的 episodes 列表写入项目（与 _apply_split_parsed 同逻辑，但直接接受 list）"""
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

    for ep_data in episodes:
        ep_number = ep_data.get("episode_number", len(result_episodes) + 1)
        ep_title = str(ep_data.get("title") or f"第{ep_number}集").strip()
        ep_content = ep_data.get("content", "")

        if ep_number in existing_by_number:
            existing_ep = existing_by_number[ep_number]
            existing_ep["script"] = ep_content
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
    # 短剧本走原版单次 LLM
    if len(content) <= SHORT_LIMIT:
        return await _split_single_llm(project_id, content, ai_config)

    # 长剧本走分块并发（仅边界）
    try:
        chunks = _chunk_text(content)
        logger.info(f"[FullScriptService] split: {len(content)} chars → {len(chunks)} chunks")
        chunk_results = await _split_chunks_parallel(project_id, chunks, ai_config,
            prompt_key="full_script_split_chunk_boundary")
        boundaries = _locate_boundaries(content, chunk_results)
        episodes = _slice_episodes(content, boundaries)
        return _apply_episodes_to_project(project_id, episodes)
    except Exception as e:
        logger.error(f"[FullScriptService] chunked split failed: {e}")
        raise RuntimeError(f"AI 分集失败：{e}")


async def _split_single_llm(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    """短剧本单次 LLM 分集（原版逻辑）"""
    llm = get_ai_service(ai_config, "llm", project_id)
    system_prompt = get_prompt_content("full_script_split", ai_config)
    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请将以下完整剧本进行分集：\n\n{content}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=64000,
            extra_body={"thinking": {"type": "disabled"}},
        )
        if response.get("error"):
            raise RuntimeError(response.get("error"))
        parsed = _extract_json(response.get("content", ""))
        if not parsed:
            raise RuntimeError("AI 返回结果无法解析，请重试")
        return _apply_split_parsed(project_id, parsed)
    except Exception as e:
        logger.error(f"[FullScriptService] single split LLM call failed: {e}")
        raise RuntimeError(f"AI 分集失败：{e}")
    finally:
        await llm.close()


async def extract_all_assets(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    # 短剧本走原版单次 LLM
    if len(content) <= SHORT_LIMIT:
        return await _extract_single_llm(project_id, content, ai_config)

    # 长剧本走分块并发（仅资产）
    try:
        chunks = _chunk_text(content)
        logger.info(f"[FullScriptService] extract: {len(content)} chars → {len(chunks)} chunks")
        chunk_results = await _split_chunks_parallel(project_id, chunks, ai_config,
            prompt_key="full_script_extract_chunk")
        merged = await _merge_assets_master(project_id, chunk_results, ai_config)
        return _apply_extract_parsed(project_id, merged)
    except Exception as e:
        logger.error(f"[FullScriptService] chunked extract failed: {e}")
        raise RuntimeError(f"AI 资产提取失败：{e}")


async def _extract_single_llm(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    """短剧本单次 LLM 资产提取（原版逻辑）"""
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
        logger.error(f"[FullScriptService] single extract LLM call failed: {e}")
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


# ── 分块工具 ──────────────────────────────────────────────────────────────────

def _chunk_text(content: str) -> List[Dict[str, Any]]:
    """将全文按字符数切分为重叠块"""
    chunks = []
    start = 0
    while start < len(content):
        end = min(start + CHUNK_SIZE, len(content))
        chunks.append({
            "index": len(chunks),
            "text": content[start:end],
            "start_offset": start,
        })
        if end >= len(content):
            break
        start = end - OVERLAP
    return chunks


def _extend_to_unique(full_text: str, pos: int, marker: str) -> str:
    """向后扩展 marker 直到全文唯一命中。无法唯一时抛 ValueError。"""
    base_len = len(marker)
    for step in (50, 100, 150, 200, 300, 500):
        end = min(pos + base_len + step, len(full_text))
        candidate = full_text[pos:end]
        if full_text.count(candidate) == 1:
            return candidate
    raise ValueError(f"Marker at {pos} cannot be made unique even at 500 chars extension")


def _locate_boundaries(full_text: str, all_chunk_results: List[Dict]) -> List[Dict]:
    """从各 chunk 结果中收集边界标记 → str.find() 定位 → 行边界校验 → 去重 → 排序"""
    markers = []
    for cr in all_chunk_results:
        for b in cr.get("boundaries", []) or []:
            m = (b.get("start_marker") or "").strip()
            if not m:
                continue
            markers.append({
                "marker": m,
                "title": b.get("title", ""),
            })

    if not markers:
        return []

    located = []
    for m in markers:
        pos = _find_at_line_boundary(full_text, m["marker"])
        if pos == -1:
            logger.warning(f"无法定位标记: {m['marker'][:50]}...")
            continue
        m["position"] = pos
        located.append(m)

    located.sort(key=lambda x: x["position"])

    # 去重：相邻边界距离 < 200 字符视为同一边界
    deduped = []
    for m in located:
        if deduped and m["position"] - deduped[-1]["position"] < 200:
            continue
        deduped.append(m)

    return deduped


def _find_at_line_boundary(full_text: str, marker: str) -> int:
    """查找 marker 在全文中的位置，确保不是更长标识符的子串（如 EPISODE 5 不匹配 EPISODE 50）"""
    pos = 0
    mlen = len(marker)
    while True:
        pos = full_text.find(marker, pos)
        if pos == -1:
            return -1
        # 检查 marker 后面的字符：不能是数字（防止 EPISODE 5 命中 EPISODE 50）
        after = pos + mlen
        if after >= len(full_text) or not full_text[after].isdigit():
            return pos
        pos += 1


def _slice_episodes(full_text: str, boundaries: List[Dict]) -> List[Dict]:
    """根据边界位置从全文切片出每集内容。

    第一个边界是 EPISODE 1 的位置，标记第一集正文开头。
    第二个边界起才是分集切割点（EPISODE 2 开头 = 第一集结尾）。
    """
    if not boundaries:
        return [{"episode_number": 1, "title": "第1集", "content": full_text.strip()}]

    sorted_bounds = sorted(boundaries, key=lambda b: b["position"])

    # 跳过第一个边界——它是第一集开头标记，不是分集切割点
    # 第一个有效切割点是第二个边界（第二集开头）
    cut_points = sorted_bounds[1:]
    if not cut_points:
        return [{"episode_number": 1, "title": "第1集", "content": full_text.strip()}]

    episodes = []
    prev_pos = 0
    for i, bound in enumerate(cut_points):
        content = full_text[prev_pos:bound["position"]].strip()
        if content:
            episodes.append({
                "episode_number": i + 1,
                "title": f"第{i + 1}集",
                "content": content,
            })
        prev_pos = bound["position"]

    # 最后一集
    content = full_text[prev_pos:].strip()
    if content:
        episodes.append({
            "episode_number": len(episodes) + 1,
            "title": f"第{len(episodes) + 1}集",
            "content": content,
        })

    return episodes if episodes else [{"episode_number": 1, "title": "第1集", "content": full_text.strip()}]


# ── 分块并发 LLM ──────────────────────────────────────────────────────────────

async def _process_one_chunk(chunk: Dict, ai_config: Dict, project_id: str, prompt_key: str = "full_script_split_chunk") -> Dict:
    """单个块的 LLM 调用。prompt_key 决定任务类型：
    - full_script_split_chunk:          边界 + 资产
    - full_script_split_chunk_boundary: 仅边界
    - full_script_extract_chunk:        仅资产
    """
    llm = get_ai_service(ai_config, "llm", project_id)
    try:
        prompt = get_prompt_content(prompt_key, ai_config)
        response = await llm.chat(
            messages=[{"role": "user", "content": f"剧本片段：\n\n{chunk['text']}"}],
            system_prompt=prompt,
            temperature=0.1,
            max_tokens=8192,
            extra_body={"thinking": {"type": "disabled"}},
        )
        if response.get("error"):
            raise RuntimeError(response.get("error"))
        parsed = _extract_json(response.get("content", ""))
        return {
            "chunk_index": chunk["index"],
            "boundaries": parsed.get("boundaries", []) or [],
            "assets": parsed if prompt_key == "full_script_extract_chunk" else (parsed.get("assets") or {}),
        }
    except Exception as e:
        logger.error(f"[FullScriptService] chunk {chunk['index']} failed: {e}")
        return {
            "chunk_index": chunk["index"],
            "boundaries": [],
            "assets": {"characters": [], "scenes": [], "props": []},
        }
    finally:
        await llm.close()


async def _split_chunks_parallel(project_id: str, chunks: List[Dict], ai_config: Dict, prompt_key: str = "full_script_split_chunk") -> List[Dict]:
    """并发调用所有块的 LLM"""
    results = await asyncio.gather(*[
        _process_one_chunk(c, ai_config, project_id, prompt_key) for c in chunks
    ])
    return sorted(results, key=lambda r: r["chunk_index"])


# ── 主资产去重合并 ────────────────────────────────────────────────────────────

async def _merge_assets_master(project_id: str, all_chunk_results: List[Dict], ai_config: Dict) -> Dict:
    """汇总所有 chunk 的原始资产，由主 LLM 去重合并"""
    raw_characters = []
    raw_scenes = []
    raw_props = []

    for cr in all_chunk_results:
        assets = cr.get("assets", {}) or {}
        for c in (assets.get("characters") or []):
            if c.get("name"):
                raw_characters.append(c)
        for s in (assets.get("scenes") or []):
            if s.get("name"):
                raw_scenes.append(s)
        for p in (assets.get("props") or []):
            if p.get("name"):
                raw_props.append(p)

    if not raw_characters and not raw_scenes and not raw_props:
        return {"characters": [], "scenes": [], "props": []}

    existing_summary = _build_existing_assets_summary(project_id)
    template = get_prompt_content("full_script_extract_merge", ai_config)
    system_prompt = _safe_format(template, existing_assets_summary=existing_summary)

    raw_json = json.dumps({
        "characters": raw_characters,
        "scenes": raw_scenes,
        "props": raw_props,
    }, ensure_ascii=False, indent=2)

    llm = get_ai_service(ai_config, "llm", project_id)
    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请将以下资产去重合并：\n\n{raw_json}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=8192,
        )
        if response.get("error"):
            raise RuntimeError(response.get("error"))
        parsed = _extract_json(response.get("content", ""))
        if not parsed:
            raise RuntimeError("合并结果无法解析为JSON")
        return parsed
    except Exception as e:
        logger.error(f"[FullScriptService] asset merge failed: {e}")
        raise RuntimeError(f"资产合并失败：{e}")
    finally:
        await llm.close()


# ── 流式接口 ──────────────────────────────────────────────────────────────────

async def _stream_split_single(project_id: str, content: str, ai_config: Dict) -> AsyncIterator[Dict[str, Any]]:
    """短剧本降级：走原版单次 LLM 分集 + 提取"""
    llm = get_ai_service(ai_config, "llm", project_id)
    try:
        split_prompt = get_prompt_content("full_script_split", ai_config)
        split_parts: List[str] = []
        split_chunks = 0
        async for evt in llm.chat_stream(
            messages=[{"role": "user", "content": f"请将以下完整剧本进行分集：\n\n{content}"}],
            system_prompt=split_prompt,
            temperature=0.1,
            max_tokens=64000,
            extra_body={"thinking": {"type": "disabled"}},
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
        logger.error(f"[FullScriptService] single split failed: {e}")
        yield {"type": "error", "content": f"处理失败：{e}"}
    finally:
        await llm.close()


async def stream_split_and_extract(
    project_id: str,
    content: str,
    ai_config: Dict,
) -> AsyncIterator[Dict[str, Any]]:
    """AI 分集并提取：流式进度接口（SSE）。长剧本自动分块并发。"""
    try:
        yield {"type": "status", "stage": "prepare", "content": "已创建处理任务，开始分析剧本..."}

        # 短剧本降级
        if len(content) <= SHORT_LIMIT:
            async for evt in _stream_split_single(project_id, content, ai_config):
                yield evt
            return

        # ── 长剧本：分块并发 ──
        chunks = _chunk_text(content)
        yield {
            "type": "status",
            "stage": "split",
            "content": f"剧本较长（{len(content)}字），已拆分为 {len(chunks)} 块，并发分析中...",
        }

        chunk_results = await _split_chunks_parallel(project_id, chunks, ai_config)

        total_boundaries = sum(len(cr.get("boundaries", [])) for cr in chunk_results)
        raw_char_count = sum(
            len(cr.get("assets", {}).get("characters", [])) +
            len(cr.get("assets", {}).get("scenes", [])) +
            len(cr.get("assets", {}).get("props", []))
            for cr in chunk_results
        )
        yield {
            "type": "status",
            "stage": "split",
            "content": f"分块分析完成，发现 {total_boundaries} 个边界、{raw_char_count} 条原始资产",
        }

        # 边界定位 → 切片
        boundaries = _locate_boundaries(content, chunk_results)
        episodes = _slice_episodes(content, boundaries)
        yield {
            "type": "status",
            "stage": "split",
            "content": f"边界定位完成，共 {len(episodes)} 集",
        }

        split_result = _apply_episodes_to_project(project_id, episodes)
        yield {"type": "split_done", "split": split_result}

        # 资产去重合并
        yield {"type": "status", "stage": "extract", "content": "开始汇总去重资产..."}

        merged_assets = await _merge_assets_master(project_id, chunk_results, ai_config)
        extract_result = _apply_extract_parsed(project_id, merged_assets)
        yield {"type": "extract_done", "extract": extract_result}

        yield {
            "type": "done",
            "split": split_result,
            "extract": extract_result,
        }

    except Exception as e:
        logger.error(f"[FullScriptService] stream split-and-extract failed: {e}")
        yield {"type": "error", "content": f"处理失败：{e}"}
