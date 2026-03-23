from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
import json
import re
import uuid
from datetime import datetime

from app.services import get_ai_service, AssetService, ScriptService, ScriptParser
from app.models.conversation import Conversation

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["conversation"])

# Force reload


class ChatMessage(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    episode_id: Optional[str] = None  # 当前工作剧集ID，传入后AI具备该集的剧本+分镜上下文
    context_messages: Optional[List[Dict]] = None  # 浏览器端存储的历史消息，优先用于LLM上下文


# 工具定义
TOOLS = [
    {
        "name": "create_character",
        "description": "创建角色资产。当用户描述角色或剧本中出现新角色时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "角色名称"},
                "description": {"type": "string", "description": "角色详细描述"},
                "gender": {"type": "string", "description": "性别"},
                "age": {"type": "string", "description": "年龄"},
                "appearance": {"type": "string", "description": "外貌描述"},
                "personality": {"type": "string", "description": "性格特点"},
                "background": {"type": "string", "description": "背景故事"}
            },
            "required": ["name", "description"]
        }
    },
    {
        "name": "update_character",
        "description": "更新现有角色的信息。当用户要求修改、完善或补充角色信息时调用。需要提供角色名称或asset_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "角色名称（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "description": {"type": "string", "description": "新的角色描述"},
                "gender": {"type": "string", "description": "性别"},
                "age": {"type": "string", "description": "年龄"},
                "appearance": {"type": "string", "description": "外貌描述"},
                "personality": {"type": "string", "description": "性格特点"},
                "background": {"type": "string", "description": "背景故事"}
            },
            "required": []
        }
    },
    {
        "name": "create_scene",
        "description": "创建场景资产。当用户描述场景或剧本中出现新场景时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "场景名称"},
                "description": {"type": "string", "description": "场景详细描述"},
                "location": {"type": "string", "description": "地点"},
                "time_of_day": {"type": "string", "description": "时间（日/夜/黄昏/黎明）"},
                "weather": {"type": "string", "description": "天气"},
                "mood": {"type": "string", "description": "氛围"}
            },
            "required": ["name", "description", "location"]
        }
    },
    {
        "name": "update_scene",
        "description": "更新现有场景的信息。当用户要求修改、完善或补充场景信息时调用。需要提供场景名称或asset_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "场景名称（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "description": {"type": "string", "description": "新的场景描述"},
                "location": {"type": "string", "description": "地点"},
                "time_of_day": {"type": "string", "description": "时间"},
                "weather": {"type": "string", "description": "天气"},
                "mood": {"type": "string", "description": "氛围"}
            },
            "required": []
        }
    },
    {
        "name": "create_prop",
        "description": "创建道具资产。仅当道具与剧情强烈相关时调用（不要提取无关道具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "道具名称"},
                "description": {"type": "string", "description": "道具详细描述"},
                "category": {"type": "string", "description": "类别（兵器/装饰/日常用品等）"},
                "era": {"type": "string", "description": "年代"}
            },
            "required": ["name", "description"]
        }
    },
    {
        "name": "update_prop",
        "description": "更新现有道具的信息。当用户要求修改、完善或补充道具信息时调用。需要提供道具名称或asset_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "道具名称（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "description": {"type": "string", "description": "新的道具描述"},
                "category": {"type": "string", "description": "类别"},
                "era": {"type": "string", "description": "年代"}
            },
            "required": []
        }
    },
    {
        "name": "create_episode",
        "description": "创建剧集。当用户提供剧本内容或明确要求创建新剧集时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_number": {"type": "integer", "description": "集数"},
                "title": {"type": "string", "description": "剧集标题"},
                "script": {"type": "string", "description": "剧本内容"},
                "summary": {"type": "string", "description": "剧情摘要"}
            },
            "required": ["episode_number", "script"]
        }
    },
    {
        "name": "update_episode",
        "description": "更新现有剧集的信息。当用户要求修改、完善或补充剧集内容时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_number": {"type": "integer", "description": "集数（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "title": {"type": "string", "description": "剧集标题"},
                "script": {"type": "string", "description": "剧本内容"},
                "summary": {"type": "string", "description": "剧情摘要"}
            },
            "required": []
        }
    },
    {
        "name": "generate_storyboard",
        "description": "为剧集生成分镜。当用户要求生成分镜、创建分镜或要求制作分镜脚本时调用。根据剧本内容自动生成多个分镜镜头。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID"},
                "script": {"type": "string", "description": "剧本内容（用于生成分镜）"}
            },
            "required": ["episode_id", "script"]
        }
    },
    {
        "name": "create_child_asset",
        "description": "为现有资产创建子资产（角色的不同年龄、状态；场景的不同时期等）。当检测到资产的变体时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "asset_type": {"type": "string", "description": "资产类型（character/scene/prop）"},
                "parent_id": {"type": "string", "description": "父资产ID"},
                "name": {"type": "string", "description": "子资产名称"},
                "description": {"type": "string", "description": "子资产描述"},
                "variant_info": {"type": "string", "description": "变体信息（如：年龄、状态、时期等）"}
            },
            "required": ["asset_type", "parent_id", "name", "description"]
        }
    },
    {
        "name": "create_storyboard",
        "description": "创建单个分镜（视频段落）。每个分镜是一段独立的15秒视频，由video_prompt驱动。需要指定所属的剧集ID。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "所属剧集的ID"},
                "sequence": {"type": "integer", "description": "分镜序号"},
                "description": {"type": "string", "description": "分镜简要描述（可选，若提供video_prompt则可省略）"},
                "video_prompt": {"type": "string", "description": "Seedance 2.0格式的视频提示词，使用@图片N引用资产图片；若角色有主音色（有音色=是），末尾需注明@音频N是xxx的声音"},
                "duration": {"type": "integer", "description": "视频时长（秒），默认15秒"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "出场角色ID列表（可选）"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "场景ID列表（可选）"},
                "scene_id": {"type": "string", "description": "场景ID（兼容旧版，优先使用scene_ids）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表（可选）"},
                "action": {"type": "string", "description": "动作描述（可选，新版已弃用）"},
                "dialogue": {"type": "string", "description": "对白（可选，新版已弃用）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选，新版已弃用）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选，新版已弃用）"}
            },
            "required": ["episode_id", "sequence"]
        }
    },
    {
        "name": "update_storyboard",
        "description": "更新现有分镜的信息。当用户要求修改、完善或补充分镜信息时调用。需要提供分镜ID或通过episode_id和sequence查找。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "分镜ID（如果提供则直接使用）"},
                "episode_id": {"type": "string", "description": "所属剧集ID（用于查找）"},
                "sequence": {"type": "integer", "description": "镜头序号（用于查找）"},
                "description": {"type": "string", "description": "新的画面描述"},
                "video_prompt": {"type": "string", "description": "Seedance 2.0格式的视频提示词，使用@图片N引用资产图片；若角色有主音色（有音色=是），末尾需注明@音频N是xxx的声音"},
                "duration": {"type": "integer", "description": "视频时长（秒）"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "角色ID列表"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "场景ID列表"},
                "scene_id": {"type": "string", "description": "场景ID（兼容旧版）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表"},
                "action": {"type": "string", "description": "动作描述（可选）"},
                "dialogue": {"type": "string", "description": "对白（可选）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选）"}
            },
            "required": []
        }
    },
    {
        "name": "delete_storyboard",
        "description": "删除指定的分镜。当用户要求删除、移除某个分镜时调用。若分镜已有视频提示词，必须传入confirmed=true才能删除（先告知用户再确认）。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "要删除的分镜ID"},
                "episode_id": {"type": "string", "description": "所属剧集ID（用于查找）"},
                "sequence": {"type": "integer", "description": "镜头序号（用于查找）"},
                "confirmed": {"type": "boolean", "description": "用户是否已确认删除（默认false）。若分镜有内容，必须传true"}
            },
            "required": []
        }
    },
    {
        "name": "insert_storyboard",
        "description": "在指定位置插入新分镜，自动将该位置及之后的分镜序号依次后移。这是拆分分镜时必须使用的工具。注意：使用insert后不需要调用reorder，因为insert会自动处理序号。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "所属剧集的asset_id（必须是UUID格式的ID，不要用集数名称如'第2集'）"},
                "insert_at_sequence": {"type": "integer", "description": "插入位置（在这个序号前插入，插入后的新分镜使用此序号）"},
                "description": {"type": "string", "description": "分镜画面描述（可选，新版主要使用video_prompt）"},
                "video_prompt": {"type": "string", "description": "Seedance 2.0格式的视频提示词，使用@图片N引用资产图片；若角色有主音色（有音色=是），末尾需注明@音频N是xxx的声音"},
                "duration": {"type": "integer", "description": "视频时长（秒），默认15秒"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "出场角色ID列表（可选）"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "场景ID列表（可选）"},
                "scene_id": {"type": "string", "description": "场景ID（兼容旧版）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表（可选）"},
                "action": {"type": "string", "description": "动作描述（可选）"},
                "dialogue": {"type": "string", "description": "对白（可选）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选）"}
            },
            "required": ["episode_id", "insert_at_sequence"]
        }
    },
    # ==================== 剧本创作工具 ====================
    {
        "name": "create_script",
        "description": "创建新的剧本。当用户要求创建新剧本、开始剧本创作时调用。如果用户提供了小说/故事内容，需要同时转换为剧本格式并作为content传入。",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "剧本标题"},
                "description": {"type": "string", "description": "剧本简介（可选）"},
                "content": {"type": "string", "description": "完整的剧本内容（可选），如果用户提供小说/故事，需要转换为剧本格式后传入。格式：'《标题》\\n人物表：\\n...\\n第1集\\n一、场景名 日 外\\n△ 视觉描述\\n角色名：台词'"}
            },
            "required": ["title"]
        }
    },
    {
        "name": "import_script_content",
        "description": "将用户提供的格式化剧本内容导入到剧本系统中。当用户提供了完整的、符合规范的剧本文本时调用。系统会自动解析人物、场景、镜头行。",
        "parameters": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string", "description": "剧本ID（从create_script返回的结果中获取）"},
                "content": {"type": "string", "description": "完整的剧本文本内容，必须符合格式规范"}
            },
            "required": ["script_id", "content"]
        }
    },
    {
        "name": "add_script_character",
        "description": "向剧本中添加人物。当用户要求添加剧本人物时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string", "description": "剧本ID"},
                "name": {"type": "string", "description": "人物名称"},
                "age": {"type": "string", "description": "年龄（可选）"},
                "gender": {"type": "string", "description": "性别（可选）"},
                "description": {"type": "string", "description": "人物描述"}
            },
            "required": ["script_id", "name"]
        }
    },
    {
        "name": "add_script_scene",
        "description": "向剧本的指定剧集添加场景。当用户要求添加场景时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "script_id": {"type": "string", "description": "剧本ID"},
                "episode_number": {"type": "integer", "description": "集数"},
                "location": {"type": "string", "description": "场景名"},
                "time_of_day": {"type": "string", "description": "时间（日/夜）"},
                "interior_exterior": {"type": "string", "description": "场景类型（内/外）"},
                "content": {"type": "string", "description": "场景完整内容（包含所有镜头行）"}
            },
            "required": ["script_id", "episode_number", "location", "content"]
        }
    }
]

# ── OpenAI Function Calling 格式的工具列表 ──
# 全工具集（含分镜工具），用于分镜 tab
OPENAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["parameters"]
        }
    }
    for tool in TOOLS
]

# 仅资产工具（不含分镜工具），用于资产 tab
_STORYBOARD_TOOL_NAMES = {
    "create_storyboard", "update_storyboard", "delete_storyboard",
    "insert_storyboard", "generate_storyboard", "create_child_asset"
}
ASSET_ONLY_TOOLS = [
    t for t in OPENAI_TOOLS
    if t["function"]["name"] not in _STORYBOARD_TOOL_NAMES
]


def check_asset_exists(project_id: str, asset_type: str, name: str) -> Optional[Dict]:
    """检查同名资产是否已存在"""
    existing_assets = AssetService.list_assets(project_id, asset_type)
    for asset in existing_assets:
        if asset.get("name") == name and not asset.get("parent_id"):
            return asset
    return None


def check_similar_asset(project_id: str, asset_type: str, name: str, description: str) -> Optional[Dict]:
    """检查相似的资产（可能需要创建子资产）"""
    existing_assets = AssetService.list_assets(project_id, asset_type)
    for asset in existing_assets:
        asset_name = asset.get("name", "")
        if name in asset_name or asset_name in name:
            asset_desc = asset.get("description", "")
            if description and asset_desc:
                name_words = set(name.split())
                asset_name_words = set(asset_name.split())
                common_words = name_words & asset_name_words
                if common_words:
                    return asset
    return None


def _resolve_episode_id(project_id: str, episode_id_input: str):
    """将 '第X集' 或 UUID 解析为实际 episode UUID。返回 (resolved_uuid, error_msg)。"""
    match = re.match(r'第(\d+)集', str(episode_id_input))
    if match:
        episode_number = int(match.group(1))
        episodes = AssetService.list_assets(project_id, "episode")
        for ep in episodes:
            if ep.get("episode_number") == episode_number:
                return ep["asset_id"], None
        return None, f"未找到第{episode_number}集"
    return episode_id_input, None


def validate_asset_refs(project_id: str, character_ids: list, scene_ids: list, prop_ids: list) -> Optional[str]:
    """校验分镜关联的资产ID是否存在且类型正确，返回错误信息或 None。"""
    for cid in (character_ids or []):
        if not cid:
            continue
        asset = AssetService.load_asset(project_id, "character", cid)
        if not asset:
            return f"character_ids 包含不存在的角色ID: {cid}（请确认该ID是角色资产）"
    for sid in (scene_ids or []):
        if not sid:
            continue
        asset = AssetService.load_asset(project_id, "scene", sid)
        if not asset:
            return f"scene_ids 包含不存在的场景ID: {sid}（请确认该ID是场景资产）"
    for pid in (prop_ids or []):
        if not pid:
            continue
        asset = AssetService.load_asset(project_id, "prop", pid)
        if not asset:
            return f"prop_ids 包含不存在的道具ID: {pid}（请确认该ID是道具资产）"
    return None


async def execute_tool_call(project_id: str, tool_name: str, parameters: Dict) -> Dict:
    """执行工具调用"""
    try:
        if tool_name == "create_character":
            # 确保必需字段存在
            if "name" not in parameters:
                return {"success": False, "error": "缺少必需字段: name"}
            if "description" not in parameters:
                parameters["description"] = parameters.get("name", "")

            # 检查是否已存在同名角色
            existing = check_asset_exists(project_id, "character", parameters["name"])
            if existing:
                return {"success": True, "asset_id": existing["asset_id"], "name": existing["name"], "already_exists": True}

            result = AssetService.save_asset(project_id, "character", parameters)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "already_exists": False}

        elif tool_name == "create_scene":
            if "name" not in parameters:
                return {"success": False, "error": "缺少必需字段: name"}
            if "description" not in parameters:
                parameters["description"] = parameters.get("name", "")
            if "location" not in parameters:
                parameters["location"] = "未知地点"

            # 检查是否已存在同名场景
            existing = check_asset_exists(project_id, "scene", parameters["name"])
            if existing:
                return {"success": True, "asset_id": existing["asset_id"], "name": existing["name"], "already_exists": True}

            result = AssetService.save_asset(project_id, "scene", parameters)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "already_exists": False}

        elif tool_name == "create_prop":
            if "name" not in parameters:
                return {"success": False, "error": "缺少必需字段: name"}
            if "description" not in parameters:
                parameters["description"] = parameters.get("name", "")

            # 检查是否已存在同名道具
            existing = check_asset_exists(project_id, "prop", parameters["name"])
            if existing:
                return {"success": True, "asset_id": existing["asset_id"], "name": existing["name"], "already_exists": True}

            result = AssetService.save_asset(project_id, "prop", parameters)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "already_exists": False}

        elif tool_name == "create_episode":
            if "script" not in parameters:
                return {"success": False, "error": "缺少必需字段: script"}
            # 如果没有提供episode_number，自动获取下一个编号
            if "episode_number" not in parameters:
                episodes = AssetService.list_assets(project_id, "episode")
                max_number = 0
                for ep in episodes:
                    if ep.get("episode_number", 0) > max_number:
                        max_number = ep.get("episode_number", 0)
                parameters["episode_number"] = max_number + 1
            else:
                # 检查该集数是否已存在
                episode_number = parameters["episode_number"]
                existing_episodes = AssetService.list_assets(project_id, "episode")
                for ep in existing_episodes:
                    if ep.get("episode_number") == episode_number:
                        return {
                            "success": True,
                            "asset_id": ep["asset_id"],
                            "name": ep.get("name", f"第{episode_number}集"),
                            "episode_number": episode_number,
                            "already_exists": True,
                            "message": f"第{episode_number}集已存在"
                        }
            # 确保有name字���
            if "name" not in parameters:
                parameters["name"] = f"第{parameters['episode_number']}集"
            result = AssetService.save_asset(project_id, "episode", parameters)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "episode_number": result.get("episode_number")}

        elif tool_name == "generate_storyboard":
            if "episode_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: episode_id"}
            if "script" not in parameters:
                return {"success": False, "error": "缺少必需字段: script"}

            # 获取AI服务
            from app.services import ProjectService, PromptService
            project = ProjectService.get_project(project_id)
            if not project:
                return {"success": False, "error": "项目不存在"}

            ai_config = project.get("ai_config", {})
            llm = get_ai_service(ai_config, "llm", project_id)

            try:
                # 调用PromptService生成分镜
                from app.api.generation.template_helpers import get_active_template
                storyboards = await PromptService.generate_storyboard_descriptions(
                    llm, parameters["script"], get_active_template(ai_config, "storyboard")
                )
                await llm.close()

                # 保存所有分镜
                results = []
                storyboard_ids = []
                for sb_data in storyboards:
                    sb_data["episode_id"] = parameters["episode_id"]
                    sb_data["asset_id"] = str(uuid.uuid4())
                    sb_data["created_at"] = datetime.now().isoformat()
                    result = AssetService.save_asset(project_id, "storyboard", sb_data)
                    results.append(result)
                    storyboard_ids.append(result["asset_id"])

                # 更新episode对象，添加storyboard_ids
                episode = AssetService.load_asset(project_id, "episode", parameters["episode_id"])
                if episode:
                    existing_ids = episode.get("storyboard_ids", [])
                    episode["storyboard_ids"] = existing_ids + storyboard_ids
                    episode["updated_at"] = datetime.now().isoformat()
                    AssetService.save_asset(project_id, "episode", episode)

                return {
                    "success": True,
                    "storyboard_count": len(results),
                    "storyboards": results,
                    "episode_id": parameters["episode_id"]
                }

            except Exception as e:
                await llm.close()
                return {"success": False, "error": f"生成分镜失败: {str(e)}"}

        elif tool_name == "update_character":
            # 查找要更新的角色
            asset_id = parameters.get("asset_id")
            if not asset_id and "name" in parameters:
                existing = check_asset_exists(project_id, "character", parameters["name"])
                if existing:
                    asset_id = existing["asset_id"]
                else:
                    return {"success": False, "error": f"未找到角色: {parameters['name']}"}

            if not asset_id:
                return {"success": False, "error": "需要提供 name 或 asset_id"}

            # 加载现有资产
            current = AssetService.load_asset(project_id, "character", asset_id)
            if not current:
                return {"success": False, "error": "角色不存在"}

            # 更新字段
            if "description" in parameters and parameters["description"]:
                current["description"] = parameters["description"]

            for key in ["gender", "age", "appearance", "personality", "background", "image_prompt"]:
                if key in parameters and parameters[key]:
                    current[key] = parameters[key]
            current["updated_at"] = datetime.now().isoformat()

            result = AssetService.save_asset(project_id, "character", current)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}

        elif tool_name == "update_scene":
            # 查找要更新的场景
            asset_id = parameters.get("asset_id")
            if not asset_id and "name" in parameters:
                existing = check_asset_exists(project_id, "scene", parameters["name"])
                if existing:
                    asset_id = existing["asset_id"]
                else:
                    return {"success": False, "error": f"未找到场景: {parameters['name']}"}

            if not asset_id:
                return {"success": False, "error": "需要提供 name 或 asset_id"}

            # 加载现有资产
            current = AssetService.load_asset(project_id, "scene", asset_id)
            if not current:
                return {"success": False, "error": "场景不存在"}

            # 更新字段
            if "description" in parameters and parameters["description"]:
                current["description"] = parameters["description"]

            # 其他字段直接替换
            for key in ["location", "time_of_day", "weather", "mood", "image_prompt"]:
                if key in parameters and parameters[key]:
                    current[key] = parameters[key]
            current["updated_at"] = datetime.now().isoformat()

            result = AssetService.save_asset(project_id, "scene", current)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}

        elif tool_name == "update_prop":
            # 查找要更新的道具
            asset_id = parameters.get("asset_id")
            if not asset_id and "name" in parameters:
                existing = check_asset_exists(project_id, "prop", parameters["name"])
                if existing:
                    asset_id = existing["asset_id"]
                else:
                    return {"success": False, "error": f"未找到道具: {parameters['name']}"}

            if not asset_id:
                return {"success": False, "error": "需要提供 name 或 asset_id"}

            # 加载现有资产
            current = AssetService.load_asset(project_id, "prop", asset_id)
            if not current:
                return {"success": False, "error": "道具不存在"}

            # 更新字段
            if "description" in parameters and parameters["description"]:
                current["description"] = parameters["description"]

            # 其他字段直接替换
            for key in ["category", "era", "material", "image_prompt"]:
                if key in parameters and parameters[key]:
                    current[key] = parameters[key]
            current["updated_at"] = datetime.now().isoformat()

            result = AssetService.save_asset(project_id, "prop", current)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}

        elif tool_name == "update_episode":
            # 查找要更新的剧集
            asset_id = parameters.get("asset_id")
            if not asset_id and "episode_number" in parameters:
                episodes = AssetService.list_assets(project_id, "episode")
                for ep in episodes:
                    if ep.get("episode_number") == parameters["episode_number"]:
                        asset_id = ep["asset_id"]
                        break
                if not asset_id:
                    return {"success": False, "error": f"未找到第{parameters['episode_number']}集"}

            if not asset_id:
                return {"success": False, "error": "需要提供 episode_number 或 asset_id"}

            # 加载现有资产
            current = AssetService.load_asset(project_id, "episode", asset_id)
            if not current:
                return {"success": False, "error": "剧集不存在"}

            # 更新字段（title 映射到模型字段 name）
            if "title" in parameters and parameters["title"]:
                current["name"] = parameters["title"]
            if "description" in parameters and parameters["description"]:
                current["description"] = parameters["description"]
            for key in ["script"]:
                if key in parameters and parameters[key]:
                    current[key] = parameters[key]
            current["updated_at"] = datetime.now().isoformat()

            result = AssetService.save_asset(project_id, "episode", current)
            return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}

        elif tool_name == "create_child_asset":
            if "asset_type" not in parameters:
                return {"success": False, "error": "缺少必需字段: asset_type"}
            if "parent_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: parent_id"}
            if "name" not in parameters:
                return {"success": False, "error": "缺少必需字段: name"}
            if "description" not in parameters:
                return {"success": False, "error": "缺少必需字段: description"}

            asset_type = parameters["asset_type"]
            if asset_type not in ["character", "scene", "prop"]:
                return {"success": False, "error": f"不支持的资产类型: {asset_type}"}

            try:
                # 调用AssetService创建子资产
                child_asset = AssetService.create_child_asset(
                    project_id,
                    asset_type,
                    parameters["parent_id"],
                    {
                        "name": parameters["name"],
                        "description": parameters["description"],
                        "variant_info": parameters.get("variant_info", ""),
                        "created_at": datetime.now().isoformat(),
                    }
                )

                return {
                    "success": True,
                    "asset_id": child_asset["asset_id"],
                    "name": child_asset["name"],
                    "parent_id": child_asset.get("parent_id")
                }

            except ValueError as e:
                return {"success": False, "error": str(e)}
            except Exception as e:
                return {"success": False, "error": f"创建子资产失败: {str(e)}"}

        elif tool_name == "create_storyboard":
            # 添加日志
            print(f"[DEBUG] create_storyboard called with params: {parameters}")

            # 验证必需字段
            if "episode_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: episode_id"}
            if "sequence" not in parameters:
                return {"success": False, "error": "缺少必需字段: sequence"}
            # description 可选（视频段落主要靠 video_prompt）
            if "description" not in parameters:
                parameters["description"] = parameters.get("video_prompt", "")[:100] if parameters.get("video_prompt") else ""
            # 设置默认时长
            if "duration" not in parameters:
                parameters["duration"] = 15

            # 解析 episode_id（支持 '第X集' 格式或直接UUID）
            episode_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
            if ep_err:
                return {"success": False, "error": ep_err}
            parameters["episode_id"] = episode_id
            print(f"[DEBUG] Resolved episode_id: {episode_id}")

            # 检查剧集是否存在
            episode = AssetService.load_asset(project_id, "episode", parameters["episode_id"])
            if not episode:
                print(f"[DEBUG] Episode not found: {parameters['episode_id']}")
                return {"success": False, "error": "剧集不存在"}

            # 检查该序号是否已存在
            existing_storyboards = AssetService.list_assets(project_id, "storyboard")
            for sb in existing_storyboards:
                if (sb.get("episode_id") == parameters["episode_id"] and
                    sb.get("sequence") == parameters["sequence"]):
                    print(f"[DEBUG] Sequence {parameters['sequence']} already exists for episode {parameters['episode_id']}")
                    return {
                        "success": False,
                        "error": f"第{parameters['sequence']}镜已存在"
                    }

            # 校验资产引用
            ref_err = validate_asset_refs(
                project_id,
                parameters.get("character_ids", []),
                parameters.get("scene_ids", []) or ([parameters["scene_id"]] if parameters.get("scene_id") else []),
                parameters.get("prop_ids", [])
            )
            if ref_err:
                return {"success": False, "error": ref_err}

            # 保存分镜
            result = AssetService.save_asset(project_id, "storyboard", parameters)
            print(f"[DEBUG] Storyboard saved: {result.get('asset_id')}")

            # 更新episode对象的storyboard_ids
            if episode:
                existing_ids = episode.get("storyboard_ids", [])
                if result["asset_id"] not in existing_ids:
                    episode["storyboard_ids"] = existing_ids + [result["asset_id"]]
                    episode["updated_at"] = datetime.now().isoformat()
                    AssetService.save_asset(project_id, "episode", episode)

            return {
                "success": True,
                "storyboard_id": result["asset_id"],
                "sequence": result.get("sequence"),
                "description": result.get("description")
            }

        elif tool_name == "update_storyboard":
            # 添加调试日志
            print(f"[DEBUG] update_storyboard called with params: {parameters}")

            # 查找要更新的分镜
            storyboard_id = parameters.get("storyboard_id")

            if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
                sequence = parameters["sequence"]
                # 解析 episode_id（支持 '第X集' 格式）
                resolved_ep_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
                if ep_err:
                    return {"success": False, "error": ep_err}
                existing_storyboards = AssetService.list_assets(project_id, "storyboard")
                for sb in existing_storyboards:
                    if sb.get("episode_id") == resolved_ep_id and sb.get("sequence") == sequence:
                        storyboard_id = sb["asset_id"]
                        break

                if not storyboard_id:
                    return {
                        "success": False,
                        "error": f"未找到第{sequence}镜，请检查episode_id和sequence是否正确"
                    }

            if not storyboard_id:
                return {"success": False, "error": "需要提供 storyboard_id 或 (episode_id + sequence)"}

            # 加载现有分镜
            current = AssetService.load_asset(project_id, "storyboard", storyboard_id)
            if not current:
                return {"success": False, "error": "分镜不存在"}

            # 更新字段
            if "description" in parameters and parameters["description"]:
                current["description"] = parameters["description"]

            # 其他字段直接替换
            for key in ["action", "dialogue", "camera_angle", "shot_type", "character_ids", "scene_id", "scene_ids", "prop_ids", "video_prompt", "duration", "image_prompt"]:
                if key in parameters and parameters[key] is not None:
                    current[key] = parameters[key]

            # 校验即将保存的资产引用
            ref_err = validate_asset_refs(
                project_id,
                current.get("character_ids", []),
                current.get("scene_ids", []) or ([current["scene_id"]] if current.get("scene_id") else []),
                current.get("prop_ids", [])
            )
            if ref_err:
                return {"success": False, "error": ref_err}

            current["updated_at"] = datetime.now().isoformat()

            result = AssetService.save_asset(project_id, "storyboard", current)
            return {
                "success": True,
                "storyboard_id": result["asset_id"],
                "sequence": result.get("sequence"),
                "character_ids": result.get("character_ids", []),
                "scene_ids": result.get("scene_ids", []),
                "prop_ids": result.get("prop_ids", []),
                "video_prompt_preview": (result.get("video_prompt") or "")[:80],
                "updated": True
            }

        elif tool_name == "delete_storyboard":
            # 查找要删除的分镜
            storyboard_id = parameters.get("storyboard_id")

            if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
                sequence = parameters["sequence"]
                resolved_ep_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
                if ep_err:
                    return {"success": False, "error": ep_err}
                existing_storyboards = AssetService.list_assets(project_id, "storyboard")
                for sb in existing_storyboards:
                    if sb.get("episode_id") == resolved_ep_id and sb.get("sequence") == sequence:
                        storyboard_id = sb["asset_id"]
                        break

                if not storyboard_id:
                    return {
                        "success": False,
                        "error": f"未找到第{sequence}镜，请检查episode_id和sequence是否正确"
                    }

            if not storyboard_id:
                return {"success": False, "error": "需要提供 storyboard_id 或 (episode_id + sequence)"}

            # 加载分镜以获取episode_id
            storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
            if not storyboard:
                return {"success": False, "error": "分镜不存在"}

            # 二次确认：若分镜有内容且未确认，拦截删除
            has_content = bool(storyboard.get("video_prompt") or storyboard.get("description"))
            confirmed = parameters.get("confirmed", False)
            if has_content and not confirmed:
                seq = storyboard.get("sequence", "?")
                desc = (storyboard.get("video_prompt") or storyboard.get("description") or "")[:60]
                return {
                    "success": False,
                    "error": f"⚠️ 第{seq}镜已有内容（{desc}...），删除前请向用户确认，确认后传入 confirmed=true 重新调用"
                }

            episode_id = storyboard.get("episode_id")

            # 删除分镜
            result = AssetService.delete_asset(project_id, "storyboard", storyboard_id)
            if not result:
                return {"success": False, "error": "删除分镜失败"}

            # 更新episode对象的storyboard_ids
            if episode_id:
                episode = AssetService.load_asset(project_id, "episode", episode_id)
                if episode:
                    existing_ids = episode.get("storyboard_ids", [])
                    episode["storyboard_ids"] = [sid for sid in existing_ids if sid != storyboard_id]
                    episode["updated_at"] = datetime.now().isoformat()
                    AssetService.save_asset(project_id, "episode", episode)

            return {
                "success": True,
                "deleted": True,
                "storyboard_id": storyboard_id
            }

        elif tool_name == "insert_storyboard":
            # 添加调试日志
            print(f"[DEBUG] insert_storyboard called with params: {parameters}")

            # 验证必需字段
            if "episode_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: episode_id"}
            if "insert_at_sequence" not in parameters:
                return {"success": False, "error": "缺少必需字段: insert_at_sequence"}
            if "description" not in parameters:
                return {"success": False, "error": "缺少必需字段: description"}

            episode_id, ep_err = _resolve_episode_id(project_id, parameters["episode_id"])
            if ep_err:
                return {"success": False, "error": ep_err}
            insert_at = parameters["insert_at_sequence"]

            # 检查剧集是否存在
            episode = AssetService.load_asset(project_id, "episode", episode_id)
            if not episode:
                print(f"[DEBUG] Episode not found: {episode_id}")
                return {"success": False, "error": "剧集不存在"}

            # 获取该剧集的所有分镜
            all_storyboards = AssetService.list_assets(project_id, "storyboard")
            episode_storyboards = [sb for sb in all_storyboards if sb.get("episode_id") == episode_id]
            episode_storyboards.sort(key=lambda x: x.get("sequence", 0))

            # 将序号 >= insert_at 的分镜序号 +1
            moved_count = 0
            for sb in episode_storyboards:
                if sb.get("sequence", 0) >= insert_at:
                    sb["sequence"] = sb.get("sequence", 0) + 1
                    sb["updated_at"] = datetime.now().isoformat()
                    AssetService.save_asset(project_id, "storyboard", sb)
                    moved_count += 1

            # 创建新分镜，使用 insert_at 作为序号
            new_storyboard = {
                "asset_id": str(uuid.uuid4()),
                "episode_id": episode_id,
                "sequence": insert_at,
                "description": parameters.get("description", ""),
                "video_prompt": parameters.get("video_prompt", ""),
                "duration": parameters.get("duration", 15),
                "action": parameters.get("action", ""),
                "dialogue": parameters.get("dialogue", ""),
                "camera_angle": parameters.get("camera_angle", ""),
                "shot_type": parameters.get("shot_type", ""),
                "character_ids": parameters.get("character_ids", []),
                "scene_id": parameters.get("scene_id", ""),
                "scene_ids": parameters.get("scene_ids", []),
                "prop_ids": parameters.get("prop_ids", []),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }

            # 校验资产引用
            ref_err = validate_asset_refs(
                project_id,
                parameters.get("character_ids", []),
                parameters.get("scene_ids", []) or ([parameters["scene_id"]] if parameters.get("scene_id") else []),
                parameters.get("prop_ids", [])
            )
            if ref_err:
                return {"success": False, "error": ref_err}

            result = AssetService.save_asset(project_id, "storyboard", new_storyboard)
            print(f"[DEBUG] Storyboard inserted at sequence {insert_at}, moved {moved_count} storyboards")

            # 更新 episode 的 storyboard_ids
            existing_ids = episode.get("storyboard_ids", [])
            if result["asset_id"] not in existing_ids:
                episode["storyboard_ids"] = existing_ids + [result["asset_id"]]
                episode["updated_at"] = datetime.now().isoformat()
                AssetService.save_asset(project_id, "episode", episode)

            return {
                "success": True,
                "storyboard_id": result["asset_id"],
                "sequence": insert_at,
                "description": result.get("description"),
                "moved_count": moved_count
            }

        # ==================== 剧本创作工具处理 ====================
        elif tool_name == "create_script":
            if "title" not in parameters:
                return {"success": False, "error": "缺少必需字段: title"}

            try:
                script = ScriptService.create_script(
                    project_id,
                    title=parameters["title"],
                    description=parameters.get("description", "")
                )

                # 如果提供了剧本内容，直接导入
                import_result = None
                if parameters.get("content"):
                    from app.services.script_service import ScriptParser
                    import_result = ScriptParser.import_script_to_project(
                        project_id, script["script_id"], parameters["content"]
                    )

                result = {
                    "success": True,
                    "script_id": script["script_id"],
                    "title": script["title"],
                    "message": f"已创建剧本: {script['title']}"
                }

                # 如果有导入结果，添加到返回值
                if import_result:
                    if import_result.get("warnings"):
                        result["warnings"] = import_result["warnings"]
                    result["import_result"] = {
                        "characters_count": import_result.get("characters_count", 0),
                        "episodes_count": import_result.get("episodes_count", 0),
                        "scenes_count": import_result.get("scenes_count", 0),
                        "lines_count": import_result.get("lines_count", 0)
                    }

                return result
            except Exception as e:
                import traceback
                traceback.print_exc()
                return {"success": False, "error": f"创建剧本失败: {str(e)}"}

        elif tool_name == "import_script_content":
            if "script_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: script_id"}
            if "content" not in parameters:
                return {"success": False, "error": "缺少必需字段: content"}

            try:
                result = ScriptParser.import_script_to_project(
                    project_id,
                    parameters["script_id"],
                    parameters["content"]
                )

                message = f"导入成功！标题: {result.get('title', '')}, 人物: {result.get('characters_count', 0)}, 集数: {result.get('episodes_count', 0)}, 场景: {result.get('scenes_count', 0)}"

                # 如果有警告，添加到消息中
                if result.get("warnings"):
                    message += f"。注意：{'; '.join(result['warnings'][:2])}"  # 只显示前2个警告

                return {
                    "success": result.get("success", True),
                    "import_result": result,
                    "message": message
                }
            except Exception as e:
                import traceback
                traceback.print_exc()
                return {"success": False, "error": f"导入剧本失败: {str(e)}"}

        elif tool_name == "add_script_character":
            if "script_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: script_id"}
            if "name" not in parameters:
                return {"success": False, "error": "缺少必需字段: name"}

            try:
                from app.services.script_service import ScriptCharacterService
                character = ScriptCharacterService.add_character(
                    project_id,
                    parameters["script_id"],
                    {
                        "name": parameters["name"],
                        "age": parameters.get("age"),
                        "gender": parameters.get("gender"),
                        "description": parameters.get("description", ""),
                        "notes": parameters.get("notes", "")
                    }
                )
                return {
                    "success": True,
                    "character_id": character["character_id"],
                    "name": character["name"],
                    "message": f"已添加剧本人物: {character['name']}"
                }
            except Exception as e:
                return {"success": False, "error": f"添加人物失败: {str(e)}"}

        elif tool_name == "add_script_scene":
            if "script_id" not in parameters:
                return {"success": False, "error": "缺少必需字段: script_id"}
            if "episode_number" not in parameters:
                return {"success": False, "error": "缺少必需字段: episode_number"}
            if "location" not in parameters:
                return {"success": False, "error": "缺少必需字段: location"}
            if "content" not in parameters:
                return {"success": False, "error": "缺少必需字段: content"}

            try:
                from app.services.script_service import (
                    ScriptEpisodeService, ScriptSceneService, ScriptLineService
                )

                # 获取或创建剧集
                episodes = ScriptEpisodeService.list_episodes(project_id, parameters["script_id"])
                episode = None
                for ep in episodes:
                    if ep["episode_number"] == parameters["episode_number"]:
                        episode = ep
                        break

                if not episode:
                    episode = ScriptEpisodeService.add_episode(
                        project_id,
                        parameters["script_id"],
                        parameters["episode_number"]
                    )

                # 解析场景内容
                content = parameters["content"]
                lines = []
                scene_sequence = 1
                line_sequence = 1

                # 解析场景头和镜头行
                content_lines = content.strip().split('\n')
                scene_header_pattern = re.compile(r'^([一二三四五六七八九十]+)、(.+?)\s+(日|夜)\s+(内|外)')
                visual_pattern = re.compile(r'^△\s*(.+)$')

                current_scene = None
                time_of_day = "日"
                interior_exterior = "外"

                for line in content_lines:
                    line = line.strip()
                    if not line:
                        continue

                    # 检查场景头
                    scene_match = scene_header_pattern.match(line)
                    if scene_match:
                        if current_scene:
                            # 保存上一个场景
                            lines.append(current_scene)

                        # 创建新场景
                        current_scene = {
                            "episode_id": episode["episode_id"],
                            "sequence": scene_sequence,
                            "location": scene_match.group(2).strip(),
                            "time_of_day": scene_match.group(3),
                            "interior_exterior": scene_match.group(4),
                            "lines": []
                        }
                        scene_sequence += 1
                        line_sequence = 1
                        continue

                    # 解析镜头行
                    if current_scene:
                        visual_match = visual_pattern.match(line)
                        if visual_match:
                            current_scene["lines"].append({
                                "line_type": "visual",
                                "sequence": line_sequence,
                                "content": line,
                                "visual_description": visual_match.group(1).strip()
                            })
                        else:
                            # 检查是否是对话
                            dialogue_match = re.match(r'^([^（:]+)(?:（([^）]+)）)?[:：](.+)', line)
                            if dialogue_match:
                                current_scene["lines"].append({
                                    "line_type": "dialogue",
                                    "sequence": line_sequence,
                                    "content": line,
                                    "character": dialogue_match.group(1).strip(),
                                    "parenthetical": dialogue_match.group(2),
                                    "dialogue": dialogue_match.group(3).strip()
                                })
                            else:
                                current_scene["lines"].append({
                                    "line_type": "action",
                                    "sequence": line_sequence,
                                    "content": line,
                                    "visual_description": line
                                })
                        line_sequence += 1

                # 保存最后一个场景
                if current_scene:
                    lines.append(current_scene)

                # 保存所有场景和镜头行
                for scene_data in lines:
                    scene = ScriptSceneService.add_scene(
                        project_id,
                        parameters["script_id"],
                        episode["episode_id"],
                        {
                            "sequence": scene_data["sequence"],
                            "location": scene_data["location"],
                            "time_of_day": scene_data["time_of_day"],
                            "interior_exterior": scene_data["interior_exterior"],
                            "content": ""
                        }
                    )

                    for line_data in scene_data.get("lines", []):
                        ScriptLineService.add_line(
                            project_id,
                            parameters["script_id"],
                            scene["scene_id"],
                            {
                                "line_type": line_data["line_type"],
                                "content": line_data["content"],
                                "sequence": line_data["sequence"],
                                "character": line_data.get("character"),
                                "parenthetical": line_data.get("parenthetical"),
                                "dialogue": line_data.get("dialogue"),
                                "visual_description": line_data.get("visual_description")
                            }
                        )

                return {
                    "success": True,
                    "episode_number": parameters["episode_number"],
                    "scenes_count": len(lines),
                    "message": f"已添加 {len(lines)} 个场景到第{parameters['episode_number']}集"
                }
            except Exception as e:
                return {"success": False, "error": f"添加场景失败: {str(e)}"}

        else:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


def parse_tool_calls(content: str) -> List[Dict]:
    """解析LLM返回的工具调用"""
    tool_calls = []

    # 查找<tool>...</tool>格式的工具调用
    pattern = r'<tool>(.*?)</tool>'
    matches = re.findall(pattern, content, re.DOTALL)

    for match in matches:
        try:
            tool_data = json.loads(match.strip())
            if "name" in tool_data and "parameters" in tool_data:
                tool_calls.append(tool_data)
                print(f"[DEBUG] Parsed <tool>: {tool_data.get('name')} with params: {tool_data.get('parameters')}")
        except Exception as e:
            print(f"[DEBUG] Failed to parse <tool>: {match[:100]}, error: {e}")
            continue

    return tool_calls


async def stream_conversation(project_id: str, message: str, conversation_id: Optional[str] = None, episode_id: Optional[str] = None, context_messages: Optional[List[Dict]] = None):
    """流式对话处理，支持Function Calling和Agentic Loop"""

    # 加载项目配置
    from app.services import ProjectService
    project = ProjectService.get_project(project_id)
    if not project:
        yield f"data: {json.dumps({'type': 'error', 'content': 'Project not found'})}\n\n"
        return

    ai_config = project.get("ai_config", {})

    # 提取全局视频风格
    from app.api.generation.style_presets import VIDEO_STYLE_PRESETS
    global_style_cfg = ai_config.get("global_style_config", {})
    video_style_cfg = global_style_cfg.get("video_style", {})
    global_style_text = ""
    if video_style_cfg.get("enabled", True):
        preset_id = video_style_cfg.get("preset_id", "none")
        custom = video_style_cfg.get("custom_suffix", "")
        parts = []
        if preset_id and preset_id != "none":
            preset = VIDEO_STYLE_PRESETS.get(preset_id, {})
            suffix_zh = preset.get("suffix_zh", "")
            if suffix_zh:
                parts.append(suffix_zh)
        if custom:
            parts.append(custom)
        global_style_text = "，".join(parts)

    # 检查API配置
    llm_config = ai_config.get("llm", {})
    if not llm_config.get("api_key"):
        yield f"data: {json.dumps({'type': 'error', 'content': '请先配置LLM API密钥（点击右上角设置图标）'})}\n\n"
        return

    # 加载或创建对话（仅用于审计日志写入，不再作为LLM上下文来源）
    conversation = Conversation(project_id, conversation_id)

    # 添加用户消息（写入文件，作为审计日志）
    conversation.add_message("user", message)

    # 获取对话上下文：优先使用浏览器端传来的历史（实现用户级隔离），否则从文件加载（兼容旧调用）
    if context_messages is not None:
        recent = context_messages[-19:]  # 最多19条，加上当前消息共20条
        context = [{"role": m["role"], "content": m["content"]} for m in recent if "role" in m and "content" in m]
        context.append({"role": "user", "content": message})
    else:
        context = conversation.get_context(last_n=20)

    # 加载项目现有资产，提供给AI作为上下文
    from app.services.asset_service import AssetService
    existing_characters = AssetService.list_assets(project_id, "character")
    existing_scenes = AssetService.list_assets(project_id, "scene")
    existing_props = AssetService.list_assets(project_id, "prop")
    existing_episodes = AssetService.list_assets(project_id, "episode")
    existing_storyboards = AssetService.list_assets(project_id, "storyboard")

    # 按剧集分组分镜信息
    storyboards_by_episode = {}
    for sb in existing_storyboards:
        ep_id = sb.get("episode_id", "")
        if ep_id not in storyboards_by_episode:
            storyboards_by_episode[ep_id] = []
        storyboards_by_episode[ep_id].append(sb)

    # 为每个剧集排序分镜
    for ep_id in storyboards_by_episode:
        storyboards_by_episode[ep_id].sort(key=lambda x: x.get("sequence", 0))

    is_storyboard_tab = bool(episode_id)

    # 分镜计数摘要（不含分镜ID，防止跨界面/跨集操作）
    storyboard_count_lines = []
    for ep in existing_episodes:
        ep_id = ep.get("asset_id", "")
        ep_number = ep.get("episode_number", "?")
        count = len(storyboards_by_episode.get(ep_id, []))
        if count > 0:
            storyboard_count_lines.append(f"第{ep_number}集: {count}个分镜")
    storyboard_summary = "，".join(storyboard_count_lines) if storyboard_count_lines else "（暂无分镜）"

    # 全局视频风格 + 提示词语言（所有 tab 均注入）
    lang_label = "中文" if global_style_cfg.get("prompt_language", "zh") == "zh" else "English"
    global_info = f"【全局视频风格】{global_style_text or '（未设置）'}\n【提示词语言】{lang_label}"

    # 分镜区块：资产 tab 不注入任何分镜信息；分镜 tab 注入计数摘要 + 当前集详情
    if is_storyboard_tab:
        storyboard_section = f"\n**分镜概况（参考用，不要修改其他集）:** {storyboard_summary}\n{{episode_context}}"
    else:
        storyboard_section = ""

    # 构建当前集专属上下文（当 episode_id 传入时）
    episode_context = ""
    if episode_id:
        ep_asset = AssetService.load_asset(project_id, "episode", episode_id)
        if ep_asset:
            ep_number = ep_asset.get("episode_number", "?")
            ep_script = ep_asset.get("script", "（无剧本）")
            ep_storyboards = storyboards_by_episode.get(episode_id, [])

            # 构建资产可用列表（供 AI 编写 @图片N / @音频N 引用）
            asset_ref_lines = []
            for c in existing_characters:
                cid = c.get("asset_id", "")
                cname = c.get("name", "")
                has_img = bool(c.get("image_id"))
                has_voice = bool(c.get("voice_audio_id"))
                asset_ref_lines.append(f"  角色: {cname} (asset_id={cid}, 有图={'是' if has_img else '否'}, 有音色={'是' if has_voice else '否'})")
            for s in existing_scenes:
                sid = s.get("asset_id", "")
                sname = s.get("name", "")
                has_img = bool(s.get("image_id"))
                asset_ref_lines.append(f"  场景: {sname} (asset_id={sid}, 有图={'是' if has_img else '否'})")

            # 构建当前集分镜详情
            sb_detail_lines = []
            for sb in ep_storyboards:
                seq = sb.get("sequence", "?")
                sb_id = sb.get("asset_id", "")
                desc = sb.get("description", "")
                vp = sb.get("video_prompt", "")
                char_ids = sb.get("character_ids", [])
                scene_ids = sb.get("scene_ids", []) or ([sb.get("scene_id")] if sb.get("scene_id") else [])
                sb_detail_lines.append(f"  第{seq}镜 [ID:{sb_id}]:")
                if desc:
                    sb_detail_lines.append(f"    描述: {desc}")
                if vp:
                    sb_detail_lines.append(f"    视频提示词: {str(vp)[:200]}")
                if char_ids:
                    sb_detail_lines.append(f"    角色IDs: {char_ids}")
                if scene_ids:
                    sb_detail_lines.append(f"    场景IDs: {scene_ids}")

            episode_context = f"""
== 当前工作集：第{ep_number}集 ==

【剧本内容】
{ep_script}

【当前集分镜列表（{len(ep_storyboards)}个，每个15秒）】
{chr(10).join(sb_detail_lines) if sb_detail_lines else "（暂无分镜）"}

【可用资产（用于视频提示词中的 @图N / @音频N 引用）】
{chr(10).join(asset_ref_lines) if asset_ref_lines else "（暂无资产）"}

【全局视频风格（必须嵌入每个video_prompt）】
{global_style_text if global_style_text else "（未设置，跳过）"}

== 分镜新模型说明 ==
- 每个分镜 = 一段独立的15秒视频，由 video_prompt 驱动
- video_prompt 使用 Seedance 2.0 格式：自然语言描述画面，@图N 引用上面的资产图片
- 资产引用规则：按使用顺序编号，@图1=第一个引用的角色/场景，@图2=第二个...
- 旧字段（shot_type/camera_angle/dialogue/action）不再必要，重心在 video_prompt
- 删除/修改已有分镜前，必须先告知用户并等待确认
"""

    # 构建项目上下文信息
    _storyboard_section = storyboard_section.replace("{episode_context}", episode_context)
    project_context = f"""
## 当前项目已有资产：

**角色 ({len(existing_characters)}个):**
{chr(10).join([f"- {c.get('name', '')} [ID:{c.get('asset_id','')}]: {c.get('description', '')[:50]}" for c in existing_characters[:10]])}

**场景 ({len(existing_scenes)}个):**
{chr(10).join([f"- {s.get('name', '')} [ID:{s.get('asset_id','')}]: {s.get('location', '')}" for s in existing_scenes[:10]])}

**道具 ({len(existing_props)}个):**
{chr(10).join([f"- {p.get('name', '')} [ID:{p.get('asset_id','')}]" for p in existing_props[:10]])}

**剧集 ({len(existing_episodes)}个):**
⚠️ 注意：episode_id必须使用下面的asset_id（UUID格式），不能使用"第2集"这样的名称！
{chr(10).join([f"- 第{e.get('episode_number', '')}集: asset_id={e.get('asset_id', '')} | {e.get('script', '')[:80]}..." for e in existing_episodes[:5]])}

{global_info}
{_storyboard_section}
"""

    # 从模板加载工具描述和系统提示词（分镜 tab 用完整工具集，资产 tab 用无分镜工具版）
    # 传入 ai_config 使项目级提示词覆盖（prompt_overrides）生效
    from app.services.global_prompt_service import get_prompt_content
    tools_desc_key = "conversation_tools_desc" if is_storyboard_tab else "conversation_tools_desc_assets"
    tools_desc = (get_prompt_content(tools_desc_key, ai_config)
                  or get_prompt_content("conversation_tools_desc", ai_config)
                  or "")
    _conv_tpl = get_prompt_content("conversation_system_prompt", ai_config)
    system_prompt = (_conv_tpl or "").format(
        project_context=project_context,
        tools_desc=tools_desc
    )

    # 创建LLM服务
    llm = get_ai_service(ai_config, "llm")

    # 选择工具集（分镜 tab 用全集，资产 tab 用无分镜子集）
    active_tools = OPENAI_TOOLS if is_storyboard_tab else ASSET_ONLY_TOOLS

    # 构建初始消息列表（agentic loop 共享）
    loop_messages = list(context)

    MAX_ITERATIONS = 20
    all_thinking_content = ""
    all_assistant_content = ""

    try:
        for iteration in range(MAX_ITERATIONS):
            thinking_buffer = ""
            content_buffer = ""
            native_tool_calls = []  # 原生 function calling 结果

            async for chunk in llm.chat_stream(loop_messages, system_prompt, tools=active_tools):
                chunk_type = chunk.get("type")
                chunk_content = chunk.get("content", "")

                if chunk_type == "thinking":
                    thinking_buffer += chunk_content
                    yield f"data: {json.dumps({'type': 'thinking', 'content': chunk_content})}\n\n"

                elif chunk_type == "thinking_end":
                    yield f"data: {json.dumps({'type': 'thinking_end', 'content': thinking_buffer})}\n\n"

                elif chunk_type == "content":
                    content_buffer += chunk_content
                    yield f"data: {json.dumps({'type': 'content', 'content': chunk_content})}\n\n"

                elif chunk_type == "content_end":
                    yield f"data: {json.dumps({'type': 'content_end', 'content': content_buffer})}\n\n"

                elif chunk_type == "tool_calls":
                    # 原生 Function Calling：模型返回了 tool_calls
                    native_tool_calls = chunk.get("tool_calls", [])

                elif chunk_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': chunk_content})}\n\n"

            all_thinking_content += thinking_buffer
            all_assistant_content += content_buffer

            # ── 解析工具调用 ──
            # 优先使用原生 Function Calling 结果；若无，回退到文本解析（兼容本地模型）
            tool_calls = []

            if native_tool_calls:
                # 原生模式：直接使用解析好的结构
                for tc in native_tool_calls:
                    tool_calls.append({
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "parameters": tc.get("arguments", {})
                    })
                print(f"[DEBUG] Iteration {iteration+1}: {len(tool_calls)} native tool_calls")
            else:
                # Fallback：从文本中正则解析（本地/不支持 function calling 的模型）
                text_tool_calls = parse_tool_calls(content_buffer)
                tool_pattern = r'TOOL:\s*(\w+)\s*\n(.*?)\nEND_TOOL'
                tool_matches = re.findall(tool_pattern, content_buffer, re.DOTALL)
                for tool_name_txt, params_json in tool_matches:
                    try:
                        params = json.loads(params_json.strip())
                        text_tool_calls.append({"name": tool_name_txt, "parameters": params})
                    except Exception:
                        pass
                for tc in text_tool_calls:
                    tool_calls.append({
                        "id": str(uuid.uuid4()),
                        "name": tc.get("name", ""),
                        "parameters": tc.get("parameters", {})
                    })
                if tool_calls:
                    print(f"[DEBUG] Iteration {iteration+1}: {len(tool_calls)} text-fallback tool_calls")

            # 若无工具调用，本轮结束
            if not tool_calls:
                break

            # ── 执行所有工具调用，收集结果 ──
            STORYBOARD_TOOLS = {
                "create_storyboard", "update_storyboard", "delete_storyboard",
                "insert_storyboard", "generate_storyboard", "create_child_asset"
            }

            # 构建 assistant 消息（含 tool_calls，按 OpenAI 协议）
            assistant_msg: Dict[str, Any] = {"role": "assistant"}
            if native_tool_calls:
                # 原生模式：assistant 消息携带 tool_calls
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.get("id", ""),
                        "type": "function",
                        "function": {
                            "name": tc.get("name", ""),
                            "arguments": json.dumps(tc.get("arguments", {}), ensure_ascii=False)
                        }
                    }
                    for tc in native_tool_calls
                ]
                if content_buffer:
                    assistant_msg["content"] = content_buffer
                else:
                    assistant_msg["content"] = None
            else:
                # Fallback 模式：assistant 消息为纯文本
                assistant_msg["content"] = content_buffer

            loop_messages.append(assistant_msg)

            # 执行工具并构建 tool 角色消息
            tool_result_msgs = []
            tool_results_lines = []  # 用于 fallback 模式的文本汇总

            for tool_call in tool_calls:
                tool_id = tool_call.get("id", str(uuid.uuid4()))
                tool_name = tool_call.get("name", "")
                parameters = tool_call.get("parameters", {})

                # 发送工具调用通知给前端
                yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': {'name': tool_name, 'parameters': parameters}})}\n\n"

                # Layer 3：资产 tab 硬拦截分镜工具
                if not is_storyboard_tab and tool_name in STORYBOARD_TOOLS:
                    error_msg = "❌ 当前界面（资产管理）不允许执行分镜操作"
                    yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'result': error_msg})}\n\n"
                    tool_result_msgs.append({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": json.dumps({"success": False, "error": error_msg}, ensure_ascii=False)
                    })
                    tool_results_lines.append(f"{tool_name} → {error_msg}")
                    continue

                # 执行工具
                result = await execute_tool_call(project_id, tool_name, parameters)
                result_json = json.dumps(result, ensure_ascii=False)

                # 发送工具执行结果给前端
                if result.get("success"):
                    if tool_name == "create_storyboard":
                        success_msg = f'✅ 成功创建第{result.get("sequence", "")}镜'
                    elif tool_name == "insert_storyboard":
                        moved = result.get("moved_count", 0)
                        success_msg = f'✅ 成功在第{result.get("sequence", "")}镜位置插入新分镜' + (f'，已将{moved}个后续分镜后移' if moved > 0 else '')
                    elif tool_name == "update_storyboard":
                        success_msg = f'✅ 成功更新第{result.get("sequence", "")}镜'
                    elif tool_name == "delete_storyboard":
                        success_msg = f'✅ 成功删除分镜'
                    elif "name" in result:
                        success_msg = f'✅ 成功创建: {result.get("name", tool_name)}'
                    else:
                        success_msg = f'✅ {tool_name} 操作成功'
                    yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'result': success_msg})}\n\n"
                    tool_results_lines.append(f"{tool_name} → {success_msg}")
                else:
                    error_msg = f'❌ 失败: {result.get("error", "未知错误")}'
                    yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'result': error_msg})}\n\n"
                    tool_results_lines.append(f"{tool_name} → {error_msg}")

                tool_result_msgs.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": result_json
                })

            if native_tool_calls:
                # 原生模式：追加 tool 角色消息列表
                loop_messages.extend(tool_result_msgs)
            else:
                # Fallback 模式：用 user 角色汇总工具结果（兼容不支持 role=tool 的模型）
                tool_results_text = "\n".join(tool_results_lines)
                loop_messages.append({
                    "role": "user",
                    "content": f"工具执行结果：\n{tool_results_text}\n\n请继续完成剩余任务。若所有任务已完成，请向用户汇报结果。"
                })

        else:
            # 达到最大迭代次数
            yield f"data: {json.dumps({'type': 'content', 'content': '\n\n[已达最大操作轮次，请继续发消息完成剩余任务]'})}\n\n"

        # 保存助手回复（合并所有轮次的内容）
        conversation.add_message("assistant", all_assistant_content, all_thinking_content)

        # 发送完成消息
        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation.conversation_id})}\n\n"

    finally:
        await llm.close()


@router.post("")
async def chat(project_id: str, chat_msg: ChatMessage):
    """对话接口（流式响应，支持Function Calling和Agentic Loop）"""
    return StreamingResponse(
        stream_conversation(project_id, chat_msg.message, chat_msg.conversation_id, chat_msg.episode_id, chat_msg.context_messages),
        media_type="text/event-stream"
    )


@router.post("/upload-script")
async def upload_script(project_id: str, file: UploadFile = File(...)):
    """
    上传剧本文件并批量提取资产
    支持的格式: .txt, .md
    """
    # 验证文件类型
    if not file.filename.endswith(('.txt', '.md')):
        raise HTTPException(status_code=400, detail="仅支持.txt和.md格式的剧本文件")

    # 读取文件内容
    content_bytes = await file.read()
    try:
        script_content = content_bytes.decode('utf-8')
    except UnicodeDecodeError:
        script_content = content_bytes.decode('gbk')

    # 加载项目配置
    from app.services import ProjectService
    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ai_config = project.get("ai_config", {})

    # 检查API配置
    llm_config = ai_config.get("llm", {})
    if not llm_config.get("api_key"):
        raise HTTPException(
            status_code=400,
            detail="请先配置LLM API密钥（点击右上角设置图标）"
        )

    # 异步处理剧本分析
    return StreamingResponse(
        stream_script_analysis(project_id, script_content, file.filename),
        media_type="text/event-stream"
    )


async def stream_script_analysis(project_id: str, script_content: str, filename: str):
    """流式处理剧本分析"""

    # 加载项目配置
    from app.services import ProjectService
    from app.services.asset_service import AssetService
    project = ProjectService.get_project(project_id)
    ai_config = project.get("ai_config", {})

    # 获取现有资产
    existing_characters = AssetService.list_assets(project_id, "character")
    existing_scenes = AssetService.list_assets(project_id, "scene")
    existing_props = AssetService.list_assets(project_id, "prop")

    # 构建项目上下文
    project_context = f"""
## 当前项目已有资产：

**角色 ({len(existing_characters)}个):**
{chr(10).join([f"- {c.get('name', '')}: {c.get('description', '')[:50]}" for c in existing_characters[:10]])}

**场景 ({len(existing_scenes)}个):**
{chr(10).join([f"- {s.get('name', '')}: {s.get('location', '')}" for s in existing_scenes[:10]])}

**道具 ({len(existing_props)}个):**
{chr(10).join([f"- {p.get('name', '')}" for p in existing_props[:10]])}
"""

    # 剧本分析的系统提示
    # 系统提示词从模板加载，支持项目级覆盖（通过 ai_config.prompt_overrides 配置）
    from app.services.global_prompt_service import get_prompt_content
    _script_tpl = get_prompt_content("script_analysis_system_prompt", ai_config)
    system_prompt = (_script_tpl or "").format(
        project_context=project_context
    )

    yield f"data: {json.dumps({'type': 'status', 'content': f'正在分析剧本文件: {filename}...'})}\n\n"
    yield f"data: {json.dumps({'type': 'status', 'content': '剧本内容预览（前200字）：'})}\n\n"
    yield f"data: {json.dumps({'type': 'status', 'content': script_content[:200] + '...' if len(script_content) > 200 else script_content})}\n\n"
    yield f"data: {json.dumps({'type': 'status', 'content': '开始AI分析...'})}\n\n"

    # 创建LLM服务并调用
    llm = get_ai_service(ai_config, "llm")

    try:
        message = f"""请分析以下剧本并提取所有资产：

剧本文件名：{filename}

剧本内容：
{script_content}

请按照上述工作流程，逐步提取并创建所有角色、场景、道具和剧集。"""

        content_buffer = ""
        native_tool_calls = []

        async for chunk in llm.chat_stream(
            [{"role": "user", "content": message}],
            system_prompt,
            tools=ASSET_ONLY_TOOLS
        ):
            chunk_type = chunk.get("type")
            chunk_content = chunk.get("content", "")

            if chunk_type == "thinking":
                yield f"data: {json.dumps({'type': 'thinking', 'content': chunk_content})}\n\n"

            elif chunk_type == "thinking_end":
                yield f"data: {json.dumps({'type': 'thinking_end'})}\n\n"

            elif chunk_type == "content":
                content_buffer += chunk_content
                yield f"data: {json.dumps({'type': 'content', 'content': chunk_content})}\n\n"

            elif chunk_type == "content_end":
                yield f"data: {json.dumps({'type': 'content_end'})}\n\n"

            elif chunk_type == "tool_calls":
                native_tool_calls = chunk.get("tool_calls", [])

            elif chunk_type == "error":
                yield f"data: {json.dumps({'type': 'error', 'content': chunk_content})}\n\n"

        # 构建工具调用列表：优先原生，fallback 文本解析
        all_tool_calls = []
        if native_tool_calls:
            for tc in native_tool_calls:
                all_tool_calls.append({
                    "name": tc.get("name", ""),
                    "parameters": tc.get("arguments", {})
                })
        else:
            tool_pattern = r'TOOL:\s*(\w+)\s*\n(.*?)\nEND_TOOL'
            tool_matches = re.findall(tool_pattern, content_buffer, re.DOTALL)
            for tool_name, params_json in tool_matches:
                try:
                    params = json.loads(params_json.strip())
                    all_tool_calls.append({"name": tool_name, "parameters": params})
                except Exception:
                    pass

        # 执行所有工具调用
        created_assets = {"characters": [], "scenes": [], "props": [], "episodes": []}

        for tool_call in all_tool_calls:
            tool_name = tool_call.get("name")
            parameters = tool_call.get("parameters", {})

            yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': tool_call})}\n\n"

            result = await execute_tool_call(project_id, tool_name, parameters)

            if result.get("success"):
                asset_type = tool_name.replace("create_", "")
                if asset_type in created_assets:
                    created_assets[asset_type].append(result.get("name"))
                success_msg = f'✅ 成功创建: {result.get("name", tool_name)}'
                yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'result': success_msg})}\n\n"
            else:
                error_msg = f'❌ 失败: {result.get("error", "未知错误")}'
                yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'result': error_msg})}\n\n"

        # 发送汇总
        yield f"data: {json.dumps({'type': 'summary', 'created_assets': created_assets})}\n\n"
        summary_msg = f'✅ 剧本分析完成！共创建 {len(created_assets["characters"])} 个角色，{len(created_assets["scenes"])} 个场景，{len(created_assets["props"])} 个道具，{len(created_assets["episodes"])} 个剧集。'
        yield f"data: {json.dumps({'type': 'status', 'content': summary_msg})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    finally:
        await llm.close()
