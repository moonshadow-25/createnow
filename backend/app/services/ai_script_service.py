"""AI 驱动的剧本解析服务"""
import json
import logging
import re
import uuid
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, AsyncIterator

from app.services.ai_service import get_ai_service
from app.services.global_prompt_service import get_prompt_content
from app.services.script_service import ScriptParser

logger = logging.getLogger(__name__)

# 当 JSON 文件中没有该 key 时的兜底 prompt
_FALLBACK_SCRIPT_PARSE_PROMPT = """\
你是专业剧本编辑助手，负责将各种格式的剧本文本解析为结构化 JSON。

## 支持的输入格式

**格式一（时间码幕结构）：**
```
《剧名》第N集：副标题
人物：
角色名：
00:00 - 01:00 | 第一幕：幕名
△ 画面描述（内含拍摄地点）
角色名（情绪）：对白
OS：旁白
```

**格式二（场景头结构）：**
```
1
片头：
场景：地点名 日/夜 内/外
人物：角色A、角色B
Vo：旁白
画面：视觉描述
角色名（情绪）：对白
```

## 输出规则

1. **characters**：提取所有出现的角色，全局去重，合并同名角色描述
   - 若角色仅有名字无描述，description 留空字符串
   - 尝试从描述中提取 age（纯数字字符串）和 gender（"男"/"女"）

2. **episodes**：按集数划分
   - 格式一：标题 `《X》第N集：副标题` → episode_number=N, title=副标题
   - 格式二：纯数字行 `1` → episode_number=1
   - 若无明确集数标记，视为第1集

3. **scenes**：识别拍摄场景（同一地点的连续内容）
   - 格式一：每个 `△` 若描述了新地点，则开启新场景；幕信息（时间码和幕名）写入 time_start/time_end/act_title
   - 格式二：每个 `场景：` 标记开启新场景；`画面：` 若描述新地点也可触发新场景
   - 从上下文推断 location（地点名）、time_of_day（"日"或"夜"）、interior_exterior（"内"或"外"）
   - 无法推断时：time_of_day 默认 "日"，interior_exterior 默认 "外"

4. **lines**：每个场景内的逐行内容
   - `△` 或 `画面：` 开头 → line_type: "visual"，写入 visual_description
   - `角色（情绪）：台词` → line_type: "dialogue"，写入 character/parenthetical/dialogue
   - `角色：台词`（无括号）→ line_type: "dialogue"
   - `OS：` 或 `Vo：` 开头 → line_type: "narration"，写入 visual_description
   - `（动作描述）` 或 `[动作描述]` → line_type: "action"，写入 visual_description
   - 其他文本 → line_type: "action"

## 输出格式

只返回如下 JSON，不要任何额外说明：

```json
{
  "title": "剧名（不含集数和副标题）",
  "characters": [
    {"name": "角色名", "age": "", "gender": "", "description": "描述"}
  ],
  "episodes": [
    {
      "episode_number": 1,
      "title": "本集副标题（如有）",
      "scenes": [
        {
          "sequence": 1,
          "location": "地点名",
          "time_of_day": "日",
          "interior_exterior": "外",
          "time_start": "00:00",
          "time_end": "01:00",
          "act_title": "第一幕：幕名",
          "lines": [
            {
              "sequence": 1,
              "line_type": "visual",
              "content": "原始文本",
              "character": null,
              "parenthetical": null,
              "dialogue": null,
              "visual_description": "视觉描述文本"
            }
          ]
        }
      ]
    }
  ],
  "warnings": ["解析过程中发现的问题描述"]
}
```

**注意：**
- time_start/time_end/act_title 无对应信息时填 null
- 每个 scene 的 sequence 在整个 episode 内全局递增（不在幕内重置）
- 每个 line 的 sequence 在所在 scene 内递增，从 0 开始
"""


async def parse_script_with_ai(project_id: str, script_id: str, text: str, ai_config: dict) -> Dict[str, Any]:
    """使用 LLM 解析剧本文本，返回与 ScriptParser.parse_script_text() 相同的结构"""

    # 获取 prompt（优先从项目/全局 JSON 文件，兜底用模块内常量）
    system_prompt = get_prompt_content("script_parse", ai_config) or _FALLBACK_SCRIPT_PARSE_PROMPT
    if not system_prompt:
        system_prompt = _FALLBACK_SCRIPT_PARSE_PROMPT

    llm = get_ai_service(ai_config, "llm", project_id)

    try:
        response = await llm.chat(
            messages=[{"role": "user", "content": f"请解析以下剧本：\n\n{text}"}],
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=32000,
            response_format={"type": "json_object"},
        )
        if response.get("error"):
            raise RuntimeError(response.get("error"))
        raw = response.get("content", "")
    except Exception as e:
        logger.error(f"[AIScriptParser] LLM call failed: {e}")
        raise RuntimeError(f"AI 解析失败：{e}")

    # 提取 JSON（LLM 可能包含 markdown 代码块）
    parsed = _extract_json(raw)
    if not parsed:
        logger.error(f"[AIScriptParser] Could not extract JSON from LLM response: {raw[:200]}")
        raise RuntimeError("AI 返回结果无法解析为 JSON，请检查 LLM 配置或稍后重试")

    # 补齐缺失字段，保证结构与 ScriptParser 兼容
    parsed.setdefault("title", "")
    parsed.setdefault("characters", [])
    parsed.setdefault("episodes", [])
    parsed.setdefault("warnings", [])
    parsed.setdefault("unparsed_lines", [])

    for ep in parsed.get("episodes", []):
        ep.setdefault("episode_number", 1)
        ep.setdefault("title", "")
        for scene in ep.get("scenes", []):
            scene.setdefault("sequence", 1)
            scene.setdefault("location", "")
            scene.setdefault("time_of_day", "日")
            scene.setdefault("interior_exterior", "外")
            scene.setdefault("time_start", None)
            scene.setdefault("time_end", None)
            scene.setdefault("act_title", None)
            for line in scene.get("lines", []):
                line.setdefault("sequence", 0)
                line.setdefault("line_type", "action")
                line.setdefault("content", "")
                line.setdefault("character", None)
                line.setdefault("parenthetical", None)
                line.setdefault("dialogue", None)
                line.setdefault("visual_description", None)

    return parsed


def _extract_json(text: str) -> Dict | None:
    """从 LLM 输出中提取 JSON 对象"""
    # 尝试直接解析
    text = text.strip()
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

    # 提取第一个 { ... }（最外层大括号）
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

    return None


def _get_import_session_dir(project_id: str, script_id: str) -> Path:
    from app.services.script_service import ScriptService
    script_dir = ScriptService._get_script_dir(project_id, script_id)
    session_dir = script_dir / "import_sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def _save_import_session(project_id: str, script_id: str, session_id: str, state: Dict[str, Any]) -> None:
    session_dir = _get_import_session_dir(project_id, script_id)
    session_file = session_dir / f"{session_id}.json"
    state["updated_at"] = datetime.now().isoformat()
    session_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_round_prompt(full_text: str, round_index: int, session_state: Dict[str, Any]) -> str:
    anchors = session_state.get("anchors_emitted", [])
    imported_characters = session_state.get("imported_characters", [])
    imported_episodes = session_state.get("imported_episodes", [])

    return f"""你要在完整剧本上下文下进行第{round_index}轮增量解析。

【完整剧本】
{full_text}

【已完成锚点】
{json.dumps(anchors, ensure_ascii=False)}

【已导入角色】
{json.dumps(imported_characters, ensure_ascii=False)}

【已导入集数】
{json.dumps(imported_episodes, ensure_ascii=False)}

【本轮目标】
1. 只输出“下一批尚未导入内容”的JSON增量，不要重复已导入内容。
2. 如仍有剩余内容，设置 has_more=true，并提供下一轮定位提示 next_hint。
3. 必须输出 start_anchor 与 end_anchor（文本锚点，可用“第X集/场景名/首句片段”）。
4. 当前单轮输出体量受限，建议本轮最多覆盖少量连续场景。

【输出格式（仅JSON，不要其他文本）】
{{
  "title": "剧本名（可选）",
  "start_anchor": "本轮起始锚点",
  "end_anchor": "本轮结束锚点",
  "has_more": true,
  "next_hint": "下一轮应从哪里继续",
  "warnings": ["可选警告"],
  "characters": [
    {{"name":"", "age":"", "gender":"", "description":""}}
  ],
  "episodes": [
    {{
      "episode_number": 1,
      "title": "",
      "scenes": [
        {{
          "location": "",
          "time_of_day": "日",
          "interior_exterior": "外",
          "time_start": null,
          "time_end": null,
          "act_title": null,
          "lines": [
            {{
              "line_type": "visual|dialogue|action|narration",
              "content": "原文",
              "character": null,
              "parenthetical": null,
              "dialogue": null,
              "visual_description": null
            }}
          ]
        }}
      ]
    }}
  ]
}}
"""


def _extract_import_round_json(text: str) -> Dict[str, Any] | None:
    parsed = _extract_json(text)
    if not parsed:
        return None
    if not isinstance(parsed, dict):
        return None
    parsed.setdefault("title", "")
    parsed.setdefault("start_anchor", "")
    parsed.setdefault("end_anchor", "")
    parsed.setdefault("has_more", False)
    parsed.setdefault("next_hint", "")
    parsed.setdefault("warnings", [])
    parsed.setdefault("characters", [])
    parsed.setdefault("episodes", [])
    return parsed


async def stream_script_import_rounds(
    project_id: str,
    script_id: str,
    text: str,
    ai_config: Dict[str, Any],
    max_rounds: int = 30,
) -> AsyncIterator[Dict[str, Any]]:
    llm = get_ai_service(ai_config, "llm", project_id)
    system_prompt = get_prompt_content("script_parse", ai_config) or _FALLBACK_SCRIPT_PARSE_PROMPT

    session_id = str(uuid.uuid4())
    session_state: Dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "round_index": 0,
        "anchors_emitted": [],
        "imported_characters": [],
        "imported_episodes": [],
        "scene_fingerprints": [],
        "line_fingerprints": [],
        "totals": {"characters": 0, "episodes": 0, "scenes": 0, "lines": 0},
        "warnings": [],
        "created_at": datetime.now().isoformat(),
    }
    _save_import_session(project_id, script_id, session_id, session_state)

    yield {
        "type": "status",
        "session_id": session_id,
        "content": "已创建导入会话，开始多轮解析...",
    }

    try:
        for round_idx in range(1, max_rounds + 1):
            session_state["round_index"] = round_idx
            _save_import_session(project_id, script_id, session_id, session_state)

            yield {
                "type": "status",
                "session_id": session_id,
                "content": f"第{round_idx}轮解析中...",
            }

            prompt = _build_round_prompt(text, round_idx, session_state)
            resp = await llm.chat(
                messages=[{"role": "user", "content": prompt}],
                system_prompt=system_prompt,
                temperature=0.1,
                max_tokens=32000,
                response_format={"type": "json_object"},
            )
            if resp.get("error"):
                raise RuntimeError(resp.get("error"))
            raw = resp.get("content", "")
            parsed = _extract_import_round_json(raw)
            if not parsed:
                snippet = (raw or "").strip()[:500]
                session_state["status"] = "failed"
                session_state["last_error"] = "本轮输出无法解析为JSON"
                session_state["raw_preview"] = snippet
                _save_import_session(project_id, script_id, session_id, session_state)
                logger.error(
                    "[AIScriptParser] round %s invalid JSON, preview=%s",
                    round_idx,
                    snippet,
                )
                yield {
                    "type": "error",
                    "session_id": session_id,
                    "content": "本轮输出不是JSON格式（模型返回了正文/推理文本），导入已中止。",
                }
                return

            start_anchor = (parsed.get("start_anchor") or "").strip()
            end_anchor = (parsed.get("end_anchor") or "").strip()
            anchor_key = f"{start_anchor} -> {end_anchor}" if start_anchor or end_anchor else ""
            if anchor_key and anchor_key in session_state["anchors_emitted"]:
                session_state["status"] = "failed"
                session_state["last_error"] = "检测到重复锚点，已中止避免重复导入"
                _save_import_session(project_id, script_id, session_id, session_state)
                yield {
                    "type": "error",
                    "session_id": session_id,
                    "content": "检测到重复锚点，已中止避免重复导入。",
                }
                return

            import_result = ScriptParser.import_partial_to_project(project_id, script_id, parsed, session_state)
            created = import_result.get("created", {})
            skipped = import_result.get("skipped", {})

            session_state["totals"]["characters"] += int(created.get("characters", 0))
            session_state["totals"]["episodes"] += int(created.get("episodes", 0))
            session_state["totals"]["scenes"] += int(created.get("scenes", 0))
            session_state["totals"]["lines"] += int(created.get("lines", 0))

            if anchor_key:
                session_state["anchors_emitted"].append(anchor_key)

            # 更新去重上下文
            for c in parsed.get("characters", []) or []:
                name = (c.get("name") or "").strip()
                if name and name not in session_state["imported_characters"]:
                    session_state["imported_characters"].append(name)
            for ep in parsed.get("episodes", []) or []:
                ep_num = ep.get("episode_number")
                if isinstance(ep_num, int) and ep_num not in session_state["imported_episodes"]:
                    session_state["imported_episodes"].append(ep_num)

            session_state["warnings"].extend(parsed.get("warnings", []))
            _save_import_session(project_id, script_id, session_id, session_state)

            yield {
                "type": "round_progress",
                "session_id": session_id,
                "round": round_idx,
                "start_anchor": start_anchor,
                "end_anchor": end_anchor,
                "created": created,
                "skipped": skipped,
                "totals": session_state["totals"],
                "has_more": bool(parsed.get("has_more", False)),
                "next_hint": parsed.get("next_hint", ""),
            }

            if not parsed.get("has_more", False):
                session_state["status"] = "completed"
                _save_import_session(project_id, script_id, session_id, session_state)
                yield {
                    "type": "done",
                    "session_id": session_id,
                    "totals": session_state["totals"],
                    "warnings": session_state.get("warnings", []),
                }
                return

        session_state["status"] = "max_rounds_reached"
        _save_import_session(project_id, script_id, session_id, session_state)
        yield {
            "type": "error",
            "session_id": session_id,
            "content": f"达到最大轮次({max_rounds})仍未完成，请继续导入。",
        }
    except Exception as e:
        session_state["status"] = "failed"
        session_state["last_error"] = str(e)
        _save_import_session(project_id, script_id, session_id, session_state)
        logger.error(f"[AIScriptParser] stream import failed: {e}")
        yield {
            "type": "error",
            "session_id": session_id,
            "content": f"导入失败：{e}",
        }
    finally:
        await llm.close()
