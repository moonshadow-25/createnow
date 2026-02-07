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
        "description": "创建单个分镜镜头。当用户要求创建、添加某个具体的分镜镜头时调用。需要指定所属的剧集ID。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "所属剧集的ID"},
                "sequence": {"type": "integer", "description": "镜头序号"},
                "description": {"type": "string", "description": "分镜画面描述"},
                "action": {"type": "string", "description": "动作描述（可选）"},
                "dialogue": {"type": "string", "description": "对白（可选）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选，如：特写、中景、远景等）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选，如：固定、推拉、平移等）"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "出场角色ID列表（可选）"},
                "scene_id": {"type": "string", "description": "场景ID（可选）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表（可选）"}
            },
            "required": ["episode_id", "sequence", "description"]
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
                "action": {"type": "string", "description": "新的动作描述"},
                "dialogue": {"type": "string", "description": "新的对白"},
                "camera_angle": {"type": "string", "description": "镜头角度"},
                "shot_type": {"type": "string", "description": "镜头类型"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "角色ID列表"},
                "scene_id": {"type": "string", "description": "场景ID"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表"}
            },
            "required": []
        }
    },
    {
        "name": "delete_storyboard",
        "description": "删除指定的分镜。当用户要求删除、移除某个分镜时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "要删除的分镜ID"},
                "episode_id": {"type": "string", "description": "所属剧集ID（用于查找）"},
                "sequence": {"type": "integer", "description": "镜头序号（用于查找）"}
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
                "description": {"type": "string", "description": "分镜画面描述"},
                "action": {"type": "string", "description": "动作描述（可选）"},
                "dialogue": {"type": "string", "description": "对白（可选）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选，如：特写、中景、远景等）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选，如：固定、推拉、平移等）"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "出场角色ID列表（可选）"},
                "scene_id": {"type": "string", "description": "场景ID（可选）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表（可选）"}
            },
            "required": ["episode_id", "insert_at_sequence", "description"]
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
        # 检查是否有相同的基础名称（例如"赵昊"和"少年赵昊"）
        asset_name = asset.get("name", "")
        if name in asset_name or asset_name in name:
            # 进一步检查描述相似度
            asset_desc = asset.get("description", "")
            # 简单的相似度检查：如果一个描述包含另一个的关键词
            if description and asset_desc:
                # 提取关键词进行比较（这里用简单的包含关系）
                name_words = set(name.split())
                asset_name_words = set(asset_name.split())
                common_words = name_words & asset_name_words
                if common_words:
                    return asset
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
                storyboards = await PromptService.generate_storyboard_descriptions(
                    llm, parameters["script"]
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

            # 更新字段 - 对于description，追加而不是替换
            if "description" in parameters and parameters["description"]:
                current_desc = current.get("description", "")
                new_desc = parameters["description"]
                # 如果新描述不是包含旧描述，则追加
                if new_desc not in current_desc:
                    current["description"] = f"{current_desc}\n{new_desc}".strip()
                else:
                    current["description"] = new_desc

            # 其他字段直接替换
            for key in ["gender", "age", "appearance", "personality", "background"]:
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

            # 更新字段 - 对于description，追加而不是替换
            if "description" in parameters and parameters["description"]:
                current_desc = current.get("description", "")
                new_desc = parameters["description"]
                # 如果新描述不是包含旧描述，则追加
                if new_desc not in current_desc:
                    current["description"] = f"{current_desc}\n{new_desc}".strip()
                else:
                    current["description"] = new_desc

            # 其他字段直接替换
            for key in ["location", "time_of_day", "weather", "mood"]:
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

            # 更新字段 - 对于description，追加而不是替换
            if "description" in parameters and parameters["description"]:
                current_desc = current.get("description", "")
                new_desc = parameters["description"]
                # 如果新描述不是包含旧描述，则追加
                if new_desc not in current_desc:
                    current["description"] = f"{current_desc}\n{new_desc}".strip()
                else:
                    current["description"] = new_desc

            # 其他字段直接替换
            for key in ["category", "era"]:
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

            # 更新字段
            for key in ["title", "script", "summary"]:
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
            if "description" not in parameters:
                return {"success": False, "error": "缺少必需字段: description"}

            # 如果episode_id是"第X集"格式，解析并查找实际的UUID
            episode_id = parameters["episode_id"]
            import re
            match = re.match(r'第(\d+)集', str(episode_id))
            if match:
                episode_number = int(match.group(1))
                # 查找对应的episode
                episodes = AssetService.list_assets(project_id, "episode")
                target_episode = None
                for ep in episodes:
                    if ep.get("episode_number") == episode_number:
                        target_episode = ep
                        break
                if target_episode:
                    parameters["episode_id"] = target_episode["asset_id"]
                    print(f"[DEBUG] Resolved episode_id from '第{episode_number}集' to '{target_episode['asset_id']}'")
                else:
                    return {"success": False, "error": f"未找到第{episode_number}集"}

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
                episode_id_input = parameters["episode_id"]
                sequence = parameters["sequence"]

                # 首先尝试直接匹配episode_id
                existing_storyboards = AssetService.list_assets(project_id, "storyboard")
                for sb in existing_storyboards:
                    if (sb.get("episode_id") == episode_id_input and
                        sb.get("sequence") == sequence):
                        storyboard_id = sb["asset_id"]
                        break

                # 如果没找到，尝试解析episode_id为"第X集"格式并查���对应的UUID
                if not storyboard_id:
                    import re
                    match = re.match(r'第(\d+)集', str(episode_id_input))
                    if match:
                        episode_number = int(match.group(1))
                        # 查找对应的episode
                        episodes = AssetService.list_assets(project_id, "episode")
                        target_episode = None
                        for ep in episodes:
                            if ep.get("episode_number") == episode_number:
                                target_episode = ep
                                break
                        if target_episode:
                            # 使用找到的UUID再次搜索
                            for sb in existing_storyboards:
                                if (sb.get("episode_id") == target_episode["asset_id"] and
                                    sb.get("sequence") == sequence):
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

            # 更新字段 - 对于description，追加而不是替换
            if "description" in parameters and parameters["description"]:
                current_desc = current.get("description", "")
                new_desc = parameters["description"]
                if new_desc not in current_desc:
                    current["description"] = f"{current_desc}\n{new_desc}".strip()
                else:
                    current["description"] = new_desc

            # 其他字段直接替换
            for key in ["action", "dialogue", "camera_angle", "shot_type", "character_ids", "scene_id", "prop_ids"]:
                if key in parameters and parameters[key] is not None:
                    current[key] = parameters[key]

            current["updated_at"] = datetime.now().isoformat()

            result = AssetService.save_asset(project_id, "storyboard", current)
            return {
                "success": True,
                "storyboard_id": result["asset_id"],
                "sequence": result.get("sequence"),
                "updated": True
            }

        elif tool_name == "delete_storyboard":
            # 查找要删除的分镜
            storyboard_id = parameters.get("storyboard_id")

            if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
                episode_id_input = parameters["episode_id"]
                sequence = parameters["sequence"]

                # 首先尝试直接匹配episode_id
                existing_storyboards = AssetService.list_assets(project_id, "storyboard")
                for sb in existing_storyboards:
                    if (sb.get("episode_id") == episode_id_input and
                        sb.get("sequence") == sequence):
                        storyboard_id = sb["asset_id"]
                        break

                # 如果没找到，尝试解析episode_id为"第X集"格式并查找对应的UUID
                if not storyboard_id:
                    import re
                    match = re.match(r'第(\d+)集', str(episode_id_input))
                    if match:
                        episode_number = int(match.group(1))
                        # 查找对应的episode
                        episodes = AssetService.list_assets(project_id, "episode")
                        target_episode = None
                        for ep in episodes:
                            if ep.get("episode_number") == episode_number:
                                target_episode = ep
                                break
                        if target_episode:
                            # 使用找到的UUID再次搜索
                            for sb in existing_storyboards:
                                if (sb.get("episode_id") == target_episode["asset_id"] and
                                    sb.get("sequence") == sequence):
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

            episode_id = parameters["episode_id"]
            insert_at = parameters["insert_at_sequence"]

            # 如果episode_id是"第X集"格式，解析并查找实际的UUID
            import re
            match = re.match(r'第(\d+)集', str(episode_id))
            if match:
                episode_number = int(match.group(1))
                # 查找对应的episode
                episodes = AssetService.list_assets(project_id, "episode")
                target_episode = None
                for ep in episodes:
                    if ep.get("episode_number") == episode_number:
                        target_episode = ep
                        break
                if target_episode:
                    episode_id = target_episode["asset_id"]
                    print(f"[DEBUG] Resolved episode_id from '第{episode_number}集' to '{episode_id}'")
                else:
                    return {"success": False, "error": f"未找到第{episode_number}集"}

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
                "action": parameters.get("action", ""),
                "dialogue": parameters.get("dialogue", ""),
                "camera_angle": parameters.get("camera_angle", ""),
                "shot_type": parameters.get("shot_type", ""),
                "character_ids": parameters.get("character_ids", []),
                "scene_id": parameters.get("scene_id", ""),
                "prop_ids": parameters.get("prop_ids", []),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }

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


async def stream_conversation(project_id: str, message: str, conversation_id: Optional[str] = None):
    """流式对话处理，支持Function Calling"""

    # 加载项目配置
    from app.services import ProjectService
    project = ProjectService.get_project(project_id)
    if not project:
        yield f"data: {json.dumps({'type': 'error', 'content': 'Project not found'})}\n\n"
        return

    ai_config = project.get("ai_config", {})

    # 检查API配置
    llm_config = ai_config.get("llm", {})
    if not llm_config.get("api_key"):
        yield f"data: {json.dumps({'type': 'error', 'content': '请先配置LLM API密钥（点击右上角设置图标）'})}\n\n"
        return

    # 加载或创建对话
    conversation = Conversation(project_id, conversation_id)

    # 添加用户消息
    conversation.add_message("user", message)

    # 获取对话上下文
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

    # 构建分镜信息字符串
    storyboard_info_lines = []
    for ep in existing_episodes:
        ep_id = ep.get("asset_id", "")
        ep_number = ep.get("episode_number", "?")
        ep_storyboards = storyboards_by_episode.get(ep_id, [])
        if ep_storyboards:
            storyboard_info_lines.append(f"**第{ep_number}集** ({len(ep_storyboards)}个分镜):")
            for sb in ep_storyboards[:30]:  # 增加到30个分镜
                seq = sb.get("sequence", "?")
                desc = sb.get("description", "")
                action = sb.get("action", "")
                dialogue = sb.get("dialogue", "")
                # 完整显示描述，不要截断
                parts = [f"第{seq}镜: {desc}"]
                if action:
                    parts.append(f"动作: {action}")
                if dialogue:
                    parts.append(f"对白: {dialogue}")
                storyboard_info_lines.append(f"  - {'. '.join(parts)}")
            if len(ep_storyboards) > 30:
                storyboard_info_lines.append(f"  ... (还有{len(ep_storyboards)-30}个分镜)")

    storyboard_info = "\n".join(storyboard_info_lines) if storyboard_info_lines else "（暂无分镜）"

    # 构建项目上下文信息
    project_context = f"""
## 当前项目已有资产：

**角色 ({len(existing_characters)}个):**
{chr(10).join([f"- {c.get('name', '')}: {c.get('description', '')[:50]}" for c in existing_characters[:10]])}

**场景 ({len(existing_scenes)}个):**
{chr(10).join([f"- {s.get('name', '')}: {s.get('location', '')}" for s in existing_scenes[:10]])}

**道具 ({len(existing_props)}个):**
{chr(10).join([f"- {p.get('name', '')}" for p in existing_props[:10]])}

**剧集 ({len(existing_episodes)}个):**
⚠️ 注意：episode_id必须使用下面的asset_id（UUID格式），不能使用"第2集"这样的名称！
{chr(10).join([f"- 第{e.get('episode_number', '')}集: asset_id={e.get('asset_id', '')} | {e.get('script', '')[:80]}..." for e in existing_episodes[:5]])}

**分镜信息:**
{storyboard_info}
"""

    # 工具定义 - 使用更清晰的格式
    tools_desc = """
可用工具：

**资产创建工具：**
1. create_character - 创建角色（需要：name, description）
2. create_scene - 创建场景（需要：name, description, location）
3. create_prop - 创建道具（需要：name, description）- 仅重要道具
4. create_episode - 创建剧集（必须包含：script剧本内容）
5. create_storyboard - 创建单个分镜镜头（需要：episode_id, sequence, description）

**资产更新工具（重要！）：**
6. update_character - 更新现有角色（需要：name用于查找，其他字段可选）
7. update_scene - 更新现有场景（需要：name用于查找，其他字段可选）
8. update_prop - 更新现有道具（需要：name用于查找，其他字段可选）
9. update_episode - 更新现有剧集（需要：episode_number用于查找，其他字段可选）
10. update_storyboard - 更新现有分镜（需要：storyboard_id或episode_id+sequence）

**删除工具：**
11. delete_storyboard - 删除分镜（需要：storyboard_id或episode_id+sequence）

**插入工具：**
12. insert_storyboard - 在指定位置插入新分镜，自动处理后续分镜序号（需要：episode_id, insert_at_sequence, description）

**剧本创作工具：**
13. create_script - 创建新剧本（需要：title）
14. import_script_content - 导入格式化剧本内容到剧本系统（需要：script_id, content）
15. add_script_character - 添加剧本人物（需要：script_id, name）
16. add_script_scene - 添加剧本场景（需要：script_id, episode_number, location, content）

⚠️ **关键规则**：
- 当用户说"修改"、"更新"、"完善"、"补充"、"调整"等词汇时，**必须使用update工具**，不要创建新资产！
- 只有在用户明确要求"创建"、"添加"、"新建"时，才使用create工具
- 使用update工具时，通过name找到现有资产，只更新用户提到的字段

调用格式（必须严格遵循）：

TOOL: create_character
{
  "name": "角色名",
  "description": "详细描述",
  "gender": "性别（可选）",
  "age": "年龄（可选）"
}
END_TOOL

TOOL: update_character
{
  "name": "要修改的角色名（用于查找）",
  "description": "新的描述",
  "gender": "性别（可选）",
  "age": "年龄（可选）"
}
END_TOOL

TOOL: create_scene
{
  "name": "场景名",
  "description": "场景详细描述",
  "location": "地点"
}
END_TOOL

TOOL: update_scene
{
  "name": "要修改的场景名（用于查找）",
  "description": "新的描述",
  "location": "地点（可选）"
}
END_TOOL

TOOL: create_episode
{
  "script": "完整的剧本内容，必须包含场景、人物、对白等"
}
END_TOOL

TOOL: create_storyboard
{
  "episode_id": "剧集的asset_id（UUID格式，从上面剧集列表中复制）",
  "sequence": 1,
  "description": "分镜画面描述",
  "action": "动作描述（可选）",
  "dialogue": "对白（可选）",
  "camera_angle": "特写/中景/远景（可选）"
}
END_TOOL

TOOL: update_storyboard
{
  "episode_id": "剧集的asset_id（UUID格式）",
  "sequence": 1,
  "description": "新的画面描述",
  "action": "新的动作描述",
  "dialogue": "新的对白"
}
END_TOOL

TOOL: delete_storyboard
{
  "episode_id": "剧集的asset_id（UUID格式）",
  "sequence": 1
}
END_TOOL

TOOL: insert_storyboard
{
  "episode_id": "剧集的asset_id（UUID格式）",
  "insert_at_sequence": 4,
  "description": "新的分镜描述",
  "action": "动作描述",
  "camera_angle": "中景"
}
END_TOOL

**剧本创作工具示例：**

## 剧本创作工作流程（小说转剧本）

当用户提供小说、故事或长篇文本要求创建剧本时：
1. 分析文本，提取主要角色、场景划分、剧情节点
2. 按照下面的剧本格式规范，将内容转换为剧本格式
3. 调用 create_script，同时传入转换后的完整剧本内容

## 剧本格式规范（严格遵守）

```
《剧本名称》
人物表：
角色名：年龄，性别，描述
角色名：描述

第1集
一、场景名  日  外
△ 【视觉描述】：镜头内容
角色名（语气）：台词内容
角色名（OS）：画外音台词
```

**格式要求检查清单**：
- ✅ 标题：使用书名号《剧本名》
- ✅ 人物表：有"人物表："行
- ✅ 集数：使用"第1集"、"第2集"格式
- ✅ 场景头：使用中文数字序号"一、场景名  日/夜  内/外"（空格分隔）
  - 支持"1. 场景名 日 外"容错格式
  - 支持"场景1：场景名 日 外"容错格式
- ✅ 视觉镜头：使用"△"开头，如"△ 【视觉开场】：镜头描述"
  - 支持"[视觉]:镜头描述"容错格式
- ✅ 对话：使用"角色名（语气）：台词"或"角色名（OS）：台词"
  - 冒号前不要有空格，冒号后要有空格

## 示例1：创建空白剧本

TOOL: create_script
{
  "title": "小阁老"
}
END_TOOL

## 示例2：根据小说内容直接创建完整剧本

TOOL: create_script
{
  "title": "小阁老",
  "content": "《小阁老》\\n人物表：\\n马湘兰：秦淮八艳之一。\\n赵昊：15岁，穿越者，现代是明史专业教师。\\n赵守正：赵昊之父，中年男子。\\n\\n第1集\\n一、金陵秦淮河 日 外\\n△ 【视觉开场】：镜头由远及近，俯瞰大明留都南京的繁华。秦淮河两岸金粉楼台，画舫穿梭。\\n△ 画舫之上，马湘兰正执扇清唱昆曲《北西厢》，曲声悠扬。\\n出片名：小阁老\\n\\n二、赵府内院大厅 日 内\\n△ 延续马湘兰的昆曲，丝竹之声绕梁。\\n（画外音OS）：大明嘉靖四十四年，南京正三品大员的五进大宅里，十五岁少年公子赵昊正被婢女环绕，尽享家世显赫、吃喝不愁的衙内生活。\\n△ 赵昊用绣着金线的锦巾蒙住双眼，正张开双臂，嬉皮笑脸地在一群俏丽婢女中穿梭。\\n赵昊（大喊）：一、二、三，摸瞎鱼！小宝贝们，谁也别想跑！"
}
END_TOOL

## 示例3：先创建剧本，再导入内容

TOOL: create_script
{
  "title": "新剧本"
}
END_TOOL

TOOL: import_script_content
{
  "script_id": "刚才创建的剧本的script_id",
  "content": "《新剧本》\\n人物表：\\n主角：20岁，男\\n\\n第1集\\n一、场景名 日 外\\n△ 视觉描述\\n角色名：台词"
}
END_TOOL

TOOL: add_script_character
{
  "script_id": "剧本ID",
  "name": "赵昊",
  "age": "15岁",
  "gender": "男",
  "description": "穿越者"
}
END_TOOL

TOOL: add_script_scene
{
  "script_id": "剧本ID",
  "episode_number": 1,
  "location": "金陵秦淮河",
  "time_of_day": "日",
  "interior_exterior": "外",
  "content": "△ 【视觉开场】：镜头由远及近，俯瞰大明留都南京的繁华。"
}
END_TOOL
"""

    system_prompt = f"""你是一个专业的AI短片制作助手。

{project_context}

{tools_desc}

## ⚠️⚠️⚠️ 最重要：分镜操作的核心原则 ⚠️⚠️⚠️

**如果用户提到"第X镜"、"拆分"、"修改分镜"等与分镜相关的操作：**
1. **首先查看上面的"分镜信息"，找到对应的分镜**
2. **必须基于该分镜现有的description内容进行操作**
3. **绝对禁止**从剧集剧本重新生成或创建分镜内容
4. **拆分分镜时**：将原分镜的description分解成多个部分，每个部分成为新分镜的description

**违反此规则的后果**：用户会得到完全错误的分镜内容！

## ⚠️ 剧集创建的最重要的规则：
当用户提供了完整的剧本内容时，create_episode工具的script字段必须包含：
1. **直接使用用户提供的完整剧本原文** - 不要自己改写或总结
2. 如果用户提供了分集剧本（如"第1集"、"第2集"），为每一集分别调用create_episode
3. script字段的值就是用户剧本的完整文本，保持原有格式

**检查剧集是否已存在**：
- 在创建剧集前，**必须先查看"当前项目已有资产"中的剧集列表**
- 如果剧本标题是"第1集"且"第1集"已存在，**不要重复创建**，直接告知用户"第1集已存在"
- 只有当剧集不存在时，才调用create_episode工具创建

**错误示例**（不要这样做）：
{{
  "name": "第一集",
  "description": "剧情摘要..."  // ❌ 这是错误的！不要用description
}}

**正确示例**（必须这样做）：
{{
  "script": "第1集\\n\\n一、金陵秦淮河 日 外\\n△ 【视觉开场】：镜头由远及近...\\n\\n（这里是用户提供的完整剧本原文，一字不改）"
}}

## ⚠️ 批量更新资产的重要规则：
当用户要求"修改所有角色"、"更新所有场景"等批量操作时：
1. **查看"当前项目已有资产"列表**，找出所有相关资产
2. **为每个资产分别调用update工具**（不是create！）
3. 只更新用户要求的字段，其他字段保持不变
4. **在更新描述时，保留原有描述内容，在其后追加新内容**，不要完全替换

**错误示例**：
- ❌ 用户说"修改所有角色"，AI创建新角色
- ❌ 用户说"更新场景描述"，AI创建新场景
- ❌ 用户说"加入风格描述"，AI完全替换了原有描述

**正确示例**：
- ✅ 用户说"修改所有角色风格为皮克斯"，AI为每个现有角色调用update_character，在原描述后追加"皮克斯卡通3D风格..."
- ✅ 用户说"更新所有场景加入3D效果"，AI为每个现有场景调用update_scene，在原描述后追加"采用3D渲染效果..."
- ✅ update时description格式："[原有描述] + [用户要求的新内容]"

## ⚠️ 资产提取的重要原则：
**只提取主要、重要、对剧情有关键作用的资产，避免过度提取**

1. **角色**：只提取有名字、有台词、有重要戏份的主要角色。不要提取路人、群众演员、无台词的小角色
2. **场景**：只提取剧情发生的主要场景。如果多个场景本质相同（如"客厅"、"沙发旁"），只创建一个主场景
3. **道具**：只提取对剧情推动有重要作用的关键道具。不要提取普通家具、日常用品等无关紧要的道具

**过度提取的错误示例**：
- ❌ 为"一个路人"、"路人甲"等创建角色
- ❌ 为"椅子"、"桌子"、"窗户"等普通家具创建道具
- ❌ 为"门口"、"窗边"等位置创建独立场景（应该归入主场景）

## ⚠️ 分镜操作的重要规则：

**在操作分镜前，必须先查看"当前项目已有资产"中的分镜信息**

1. **更新现有分镜**：
   - 当用户说"修改第X镜"、"更新第X镜"、"第X镜改成..."时，使用 `update_storyboard` 工具
   - 必须提供 `episode_id` 和 `sequence` 来定位分镜
   - 只更新用户提到的字段

2. **拆分分镜（最重要的规则）**：
   - 当用户要求"拆分第X镜"、"把第X镜分成N个镜头"时：
   - **必须使用 `insert_storyboard` 工具**，严禁使用 `create_storyboard`！
   - `insert_storyboard` 会自动处理后续分镜的序号位移
   - **严禁调用 `reorder_storyboards`！insert已经自动处理了序号！**
   - **必须基于原分镜的description内容进行拆分**，绝对不能从剧本重新生成！
   - **episode_id必须使用UUID格式，不能使用"第2集"这样的显示名称！**
   - 操作步骤：先调用 `update_storyboard` 修改原分镜内容为第一部分，然后多次调用 `insert_storyboard` 插入后续部分
   - 例如：原第3镜是"快速移动镜头，从河面掠过，穿过层层叠叠的黛瓦屋顶和院墙，最终摇进一座气派府邸的后花园"
     - 拆分成3个：
       1. update_storyboard: episode_id="uuid-xxx", sequence=3, description="从河面快速掠过"
       2. insert_storyboard: episode_id="uuid-xxx", insert_at_sequence=4, description="穿过黛瓦屋顶和院墙"
       3. insert_storyboard: episode_id="uuid-xxx", insert_at_sequence=5, description="摇进府邸后花园"

3. **删除分镜**：
   - 当用户说"删除第X镜"��"移除第X镜"时，使用 `delete_storyboard` 工具

4. **创建新分镜**：
   - 当用户要求"添加一个镜头"、"在X镜后面插入"时，使用 `create_storyboard` 工具
   - 需要指定合适的 sequence 号

**错误示例（绝对不要这样做）**：
- ❌ 用户说"把第3镜拆成3个"，AI忽略现有分镜内容，从剧本重新生成3个新分镜
- ❌ 用户说"修改第3镜"，AI使用剧集剧本而不是现有分镜内容
- ❌ 拆分时使用create_storyboard而不是insert_storyboard
- ❌ 拆分后调用reorder_storyboards（完全多余，insert已自动处理）
- ❌ 使用"第2集"作为episode_id（必须使用UUID格式的asset_id）

**正确示例（必须这样做）**：
- ✅ 用户说"修改第3镜，把特写改成中景"，AI调用 update_storyboard，修改 camera_angle
- ✅ 用户说"把第3镜拆成3个"，AI基于原第3镜的description进行拆分：
  - update第3镜为第一部分
  - insert第4镜为第二部分
  - insert第5镜为第三部分
  - 不调用reorder_storyboards
- ✅ 拆分时原分镜的description必须保留，只是分解成多个镜头
- ✅ episode_id使用UUID格式（从剧集列表中复制asset_id）

## 工作流程：
1. 先从用户输入中识别出**主要角色**（有名字、有台词、重要戏份），调用create_character创建
2. 识别出**主要场景**（剧情发生的关键地点），调用create_scene创建
3. 识别出**关键道具**（对剧情有推动作用），调用create_prop创建
4. 最后，如果用户提供了剧本，**直接使用用户提供的剧本原文**调用create_episode

## ⚠️ 其他注意事项：
- create_episode只需要script字段，不需要name、description等
- **检查资产是否存在**：在创建角色、场景、道具前，先查看"当前项目已有资产"，如果同名资产已存在，不要重复创建
- **宁缺毋滥**：如果某个资产不重要或不确定，就不要创建
- 必须使用TOOL:格式调用工具
- 每次调用后必须用END_TOOL结束
- JSON格式必须正确
- 创建资产后要告知用户

开始工作吧！"""

    # 创建LLM服务
    llm = get_ai_service(ai_config, "llm")

    try:
        thinking_buffer = ""
        content_buffer = ""
        all_tool_calls = []

        async for chunk in llm.chat_stream(context, system_prompt):
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

            elif chunk_type == "error":
                yield f"data: {json.dumps({'type': 'error', 'content': chunk_content})}\n\n"

        # 解析工具调用 - 支持两种格式
        tool_calls = parse_tool_calls(content_buffer)

        # 添加调试日志
        print(f"[DEBUG] Parsed {len(tool_calls)} tool calls from content_buffer")

        # 也尝试解析TOOL:格式
        tool_pattern = r'TOOL:\s*(\w+)\s*\n(.*?)\nEND_TOOL'
        tool_matches = re.findall(tool_pattern, content_buffer, re.DOTALL)

        print(f"[DEBUG] Found {len(tool_matches)} TOOL: format matches")

        for tool_name, params_json in tool_matches:
            try:
                params = json.loads(params_json.strip())
                tool_calls.append({"name": tool_name, "parameters": params})
                print(f"[DEBUG] Parsed TOOL: {tool_name} with params: {params}")
            except Exception as e:
                print(f"[DEBUG] Failed to parse TOOL: {tool_name}, error: {e}")

        # 执行所有工具调用
        for tool_call in tool_calls:
            tool_name = tool_call.get("name")
            parameters = tool_call.get("parameters", {})

            # 发送工具调用通知
            yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': tool_call})}\n\n"

            # 执行工具
            result = await execute_tool_call(project_id, tool_name, parameters)

            # 发送工具执行结果
            if result.get("success"):
                # 根据不同工具类型返回不同的成功消息
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
            else:
                error_msg = f'❌ 失败: {result.get("error", "未知错误")}'
                yield f"data: {json.dumps({'type': 'tool_result', 'tool_name': tool_name, 'result': error_msg})}\n\n"

            all_tool_calls.append(tool_call)

        # 保存助手回复
        conversation.add_message("assistant", content_buffer, thinking_buffer)

        # 发送完成消息
        yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation.conversation_id})}\n\n"

    finally:
        await llm.close()


@router.post("")
async def chat(project_id: str, chat_msg: ChatMessage):
    """对话接口（流式响应，支持Function Calling）"""
    return StreamingResponse(
        stream_conversation(project_id, chat_msg.message, chat_msg.conversation_id),
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
    system_prompt = f"""你是一个专业的剧本分析助手。

{project_context}

## 任务：
分析用户上传的完整剧本，提取出所有资产并创建。

## 工具可用：
1. create_character - 创建角色
2. create_scene - 创建场景
3. create_prop - 创建道具
4. create_episode - 创建剧集

## 调用格式：
TOOL: create_character
{{
  "name": "角色名",
  "description": "详细描述",
  "gender": "性别",
  "age": "年龄"
}}
END_TOOL

TOOL: create_episode
{{
  "episode_number": 集数,
  "script": "剧本内容（保持原有格式）"
}}
END_TOOL

## ⚠️ 重要规则：
1. **先创建所有角色、场景、道具**，最后创建剧集
2. **检查资产是否已存在**，不要重复创建
3. **完整保留剧本原文**在create_episode的script字段中
4. 如果剧本包含多集（如"第1集"、"第2集"），为每一集分别调用create_episode
5. 如果没有明确分集，将整个剧本作为第1集

## 工作流程：
1. 先识别并列出所有角色，逐个调用create_character
2. 识别并列出所有场景，逐个调用create_scene
3. 识别并列出重要道具，逐个调用create_prop
4. 最后按集数创建剧集

开始分析剧本吧！
"""

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
        all_tool_calls = []

        async for chunk in llm.chat_stream(
            [{"role": "user", "content": message}],
            system_prompt
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

            elif chunk_type == "error":
                yield f"data: {json.dumps({'type': 'error', 'content': chunk_content})}\n\n"

        # 解析工具调用
        tool_pattern = r'TOOL:\s*(\w+)\s*\n(.*?)\nEND_TOOL'
        tool_matches = re.findall(tool_pattern, content_buffer, re.DOTALL)

        for tool_name, params_json in tool_matches:
            try:
                params = json.loads(params_json.strip())
                tool_calls = {"name": tool_name, "parameters": params}
                all_tool_calls.append(tool_calls)
            except:
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
