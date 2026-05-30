"""全剧本导入服务 — 分集 / 资产提取 / 分块并发分集并提取"""
import asyncio
import json
import re
import uuid
import logging
from typing import Dict, List, Any, AsyncIterator
from datetime import datetime

from app.services.ai_service import get_ai_service
from app.services.asset_service import AssetService
from app.services.global_prompt_service import get_prompt_content

logger = logging.getLogger(__name__)

# 分块参数（按行切分，保证不破坏"行号\t"前缀）
CHUNK_LINES = 250
OVERLAP_LINES = 25


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _safe_format(template: str, **kwargs) -> str:
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _extract_json(text: str) -> Dict:
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


# ── 行号工具 ──────────────────────────────────────────────────────────────────

def _add_line_numbers(text: str) -> tuple:
    """给文本每行加上显式行号前缀。返回 (带行号的文本, {行号: 原文中该行的字符位置})。"""
    lines = text.split('\n')
    numbered_lines = []
    positions = {}
    pos = 0
    for i, line in enumerate(lines, 1):
        numbered_lines.append(f"{i}\t{line}")
        positions[i] = pos
        pos += len(line) + 1
    return '\n'.join(numbered_lines), positions


def _collect_boundaries(chunk_results: List[Dict]) -> List[int]:
    """从各 chunk 的 LLM 结果中收集分集行号，去重排序后返回。"""
    line_numbers = set()
    for cr in chunk_results:
        for b in cr.get("boundaries", []) or []:
            ln = b.get("line_number")
            if isinstance(ln, int) and ln > 0:
                line_numbers.add(ln)
    return sorted(line_numbers)


def _slice_episodes_by_lines(full_text: str, boundary_lines: List[int], line_positions: Dict) -> List[Dict]:
    """根据分集起始行号，从原文中切片出每集内容。"""
    if not boundary_lines:
        return [{"episode_number": 1, "title": "第1集", "content": full_text.strip()}]

    # 第一个行号是第一集正文开头，后面的行号是各集分割点
    cut_lines = boundary_lines[1:] if len(boundary_lines) > 1 else []
    prev_pos = line_positions[boundary_lines[0]]

    episodes = []
    skipped = 0
    for i, cut_ln in enumerate(cut_lines):
        cut_pos = line_positions.get(cut_ln)
        if cut_pos is None:
            logger.warning(f"[FullScriptService] line_positions missing key={cut_ln}")
            skipped += 1
            continue
        content = full_text[prev_pos:cut_pos].strip()
        if content:
            episodes.append({
                "episode_number": i + 1,
                "title": f"第{i + 1}集",
                "content": content,
            })
        else:
            logger.warning(f"[FullScriptService] empty episode at i={i} cut_ln={cut_ln} prev_pos={prev_pos} cut_pos={cut_pos}")
            skipped += 1
        prev_pos = cut_pos

    if skipped:
        logger.warning(f"[FullScriptService] skipped {skipped} episodes, kept {len(episodes)}")

    # 最后一集
    content = full_text[prev_pos:].strip()
    if content:
        episodes.append({
            "episode_number": len(episodes) + 1,
            "title": f"第{len(episodes) + 1}集",
            "content": content,
        })

    return episodes if episodes else [{"episode_number": 1, "title": "第1集", "content": full_text.strip()}]


# ── 资产写入 ──────────────────────────────────────────────────────────────────

def _apply_episodes_to_project(project_id: str, episodes: List[Dict]) -> Dict[str, Any]:
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


# ── 分块工具 ──────────────────────────────────────────────────────────────────

def _chunk_text(content: str) -> List[Dict[str, Any]]:
    """按行切分文本，保证每块在换行符处开始和结束，不破坏行结构。"""
    lines = content.split('\n')
    chunks = []
    start_line = 0
    while start_line < len(lines):
        end_line = min(start_line + CHUNK_LINES, len(lines))
        chunk_text = '\n'.join(lines[start_line:end_line])
        chunks.append({
            "index": len(chunks),
            "text": chunk_text,
            "start_offset": start_line,
        })
        if end_line >= len(lines):
            break
        start_line = end_line - OVERLAP_LINES
    return chunks


# ── 主接口 ────────────────────────────────────────────────────────────────────

async def split_into_episodes(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    try:
        numbered_text, line_positions = _add_line_numbers(content)
        chunks = _chunk_text(numbered_text)
        logger.info(f"[FullScriptService] split: {len(content)} chars → {len(chunks)} chunks")
        chunk_results = await _split_chunks_parallel(project_id, chunks, ai_config,
            prompt_key="full_script_split_chunk_boundary")
        boundary_lines = _collect_boundaries(chunk_results)
        episodes = _slice_episodes_by_lines(content, boundary_lines, line_positions)
        return _apply_episodes_to_project(project_id, episodes)
    except Exception as e:
        logger.error(f"[FullScriptService] split failed: {e}")
        raise RuntimeError(f"AI 分集失败：{e}")


async def extract_all_assets(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    try:
        # 资产提取不需要行号，直接用原文分块
        chunks = _chunk_text(content)
        logger.info(f"[FullScriptService] extract: {len(content)} chars → {len(chunks)} chunks")
        chunk_results = await _split_chunks_parallel(project_id, chunks, ai_config,
            prompt_key="full_script_extract_chunk")
        merged = await _merge_assets_master(project_id, chunk_results, ai_config)
        return _apply_extract_parsed(project_id, merged)
    except Exception as e:
        logger.error(f"[FullScriptService] extract failed: {e}")
        raise RuntimeError(f"AI 资产提取失败：{e}")


async def split_and_extract(project_id: str, content: str, ai_config: Dict) -> Dict[str, Any]:
    split_result = await split_into_episodes(project_id, content, ai_config)
    extract_result = await extract_all_assets(project_id, content, ai_config)
    return {
        "split": split_result,
        "extract": extract_result,
    }


# ── 分块并发 LLM ──────────────────────────────────────────────────────────────

async def _process_one_chunk(chunk: Dict, ai_config: Dict, project_id: str, prompt_key: str = "full_script_split_chunk_boundary") -> Dict:
    """单个块的 LLM 调用。"""
    llm = get_ai_service(ai_config, "llm", project_id)
    try:
        prompt = get_prompt_content(prompt_key, ai_config)
        response = await llm.chat(
            messages=[{"role": "user", "content": f"剧本片段：\n\n{chunk['text']}"}],
            system_prompt=prompt,
            temperature=0.1,
            max_tokens=32768,
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


async def _split_chunks_parallel(project_id: str, chunks: List[Dict], ai_config: Dict, prompt_key: str = "full_script_split_chunk_boundary") -> List[Dict]:
    results = await asyncio.gather(*[
        _process_one_chunk(c, ai_config, project_id, prompt_key) for c in chunks
    ])
    return sorted(results, key=lambda r: r["chunk_index"])


# ── 资产去重合并 ──────────────────────────────────────────────────────────────

async def _merge_assets_master(project_id: str, all_chunk_results: List[Dict], ai_config: Dict) -> Dict:
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

async def stream_split_and_extract(
    project_id: str,
    content: str,
    ai_config: Dict,
) -> AsyncIterator[Dict[str, Any]]:
    """AI 分集并提取：流式进度接口（SSE）。"""
    try:
        yield {"type": "status", "stage": "prepare", "content": "已创建处理任务，开始分析剧本..."}

        numbered_text, line_positions = _add_line_numbers(content)
        chunks = _chunk_text(numbered_text)
        yield {
            "type": "status",
            "stage": "split",
            "content": f"剧本共 {len(content)} 字，拆分为 {len(chunks)} 块，并发分析中...",
        }

        chunk_results = await _split_chunks_parallel(
            project_id,
            chunks,
            ai_config,
            prompt_key="full_script_split_chunk_boundary",
        )

        total_boundaries = sum(len(cr.get("boundaries", [])) for cr in chunk_results)
        yield {
            "type": "status",
            "stage": "split",
            "content": f"分块分析完成，发现 {total_boundaries} 个边界",
        }

        boundary_lines = _collect_boundaries(chunk_results)
        episodes = _slice_episodes_by_lines(content, boundary_lines, line_positions)
        yield {
            "type": "status",
            "stage": "split",
            "content": f"边界定位完成，共 {len(episodes)} 集",
        }

        split_result = _apply_episodes_to_project(project_id, episodes)
        yield {"type": "split_done", "split": split_result}

        yield {"type": "status", "stage": "extract", "content": "开始提取资产..."}

        extract_chunks = _chunk_text(content)
        extract_chunk_results = await _split_chunks_parallel(
            project_id,
            extract_chunks,
            ai_config,
            prompt_key="full_script_extract_chunk",
        )
        raw_asset_count = sum(
            len(cr.get("assets", {}).get("characters", [])) +
            len(cr.get("assets", {}).get("scenes", [])) +
            len(cr.get("assets", {}).get("props", []))
            for cr in extract_chunk_results
        )
        yield {
            "type": "status",
            "stage": "extract",
            "content": f"资产分块提取完成，发现 {raw_asset_count} 条原始资产，开始去重合并...",
        }

        merged_assets = await _merge_assets_master(project_id, extract_chunk_results, ai_config)
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
