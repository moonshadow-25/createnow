"""AI 驱动的剧本解析服务"""
import json
import logging
import re
from typing import Dict, Any

from app.services.ai_service import get_ai_service
from app.services.global_prompt_service import get_prompt_content

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
        )
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
