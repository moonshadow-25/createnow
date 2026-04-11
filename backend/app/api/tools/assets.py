"""资产创建/更新工具执行逻辑"""
import uuid
from datetime import datetime
from typing import Dict
from app.services import AssetService, get_ai_service
from .helpers import check_asset_exists, _resolve_episode_id


async def handle_create_character(project_id: str, parameters: Dict) -> Dict:
    if "name" not in parameters:
        return {"success": False, "error": "缺少必需字段: name"}
    if "description" not in parameters:
        parameters["description"] = parameters.get("name", "")
    existing = check_asset_exists(project_id, "character", parameters["name"])
    if existing:
        return {"success": True, "asset_id": existing["asset_id"], "name": existing["name"], "already_exists": True}
    result = AssetService.save_asset(project_id, "character", parameters)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "already_exists": False}


async def handle_create_scene(project_id: str, parameters: Dict) -> Dict:
    if "name" not in parameters:
        return {"success": False, "error": "缺少必需字段: name"}
    if "description" not in parameters:
        parameters["description"] = parameters.get("name", "")
    if "location" not in parameters:
        parameters["location"] = "未知地点"
    existing = check_asset_exists(project_id, "scene", parameters["name"])
    if existing:
        return {"success": True, "asset_id": existing["asset_id"], "name": existing["name"], "already_exists": True}
    result = AssetService.save_asset(project_id, "scene", parameters)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "already_exists": False}


async def handle_create_prop(project_id: str, parameters: Dict) -> Dict:
    if "name" not in parameters:
        return {"success": False, "error": "缺少必需字段: name"}
    if "description" not in parameters:
        parameters["description"] = parameters.get("name", "")
    existing = check_asset_exists(project_id, "prop", parameters["name"])
    if existing:
        return {"success": True, "asset_id": existing["asset_id"], "name": existing["name"], "already_exists": True}
    result = AssetService.save_asset(project_id, "prop", parameters)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "already_exists": False}


async def handle_create_episode(project_id: str, parameters: Dict) -> Dict:
    if "script" not in parameters:
        return {"success": False, "error": "缺少必需字段: script"}
    if "episode_number" not in parameters:
        episodes = AssetService.list_assets(project_id, "episode")
        max_number = max((ep.get("episode_number", 0) for ep in episodes), default=0)
        parameters["episode_number"] = max_number + 1
    else:
        episode_number = parameters["episode_number"]
        for ep in AssetService.list_assets(project_id, "episode"):
            if ep.get("episode_number") == episode_number:
                return {"success": True, "asset_id": ep["asset_id"], "name": ep.get("name", f"第{episode_number}集"),
                        "episode_number": episode_number, "already_exists": True, "message": f"第{episode_number}集已存在"}
    if "name" not in parameters:
        parameters["name"] = f"第{parameters['episode_number']}集"
    result = AssetService.save_asset(project_id, "episode", parameters)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "episode_number": result.get("episode_number")}


async def handle_generate_storyboard(project_id: str, parameters: Dict, ai_config: Dict) -> Dict:
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    if "script" not in parameters:
        return {"success": False, "error": "缺少必需字段: script"}
    llm = get_ai_service(ai_config, "llm", project_id)
    try:
        from app.services import PromptService
        from app.api.generation.template_helpers import get_active_template
        storyboards = await PromptService.generate_storyboard_descriptions(
            llm, parameters["script"], get_active_template(ai_config, "storyboard")
        )
        await llm.close()
        results = []
        storyboard_ids = []
        for sb_data in storyboards:
            sb_data["episode_id"] = parameters["episode_id"]
            sb_data["asset_id"] = str(uuid.uuid4())
            sb_data["created_at"] = datetime.now().isoformat()
            result = AssetService.save_asset(project_id, "storyboard", sb_data)
            results.append(result)
            storyboard_ids.append(result["asset_id"])
        episode = AssetService.load_asset(project_id, "episode", parameters["episode_id"])
        if episode:
            existing_ids = episode.get("storyboard_ids", [])
            episode["storyboard_ids"] = existing_ids + storyboard_ids
            episode["updated_at"] = datetime.now().isoformat()
            AssetService.save_asset(project_id, "episode", episode)
        return {"success": True, "storyboard_count": len(results), "storyboards": results, "episode_id": parameters["episode_id"]}
    except Exception as e:
        await llm.close()
        return {"success": False, "error": f"生成分镜失败: {str(e)}"}


async def handle_update_character(project_id: str, parameters: Dict) -> Dict:
    asset_id = parameters.get("asset_id")
    if not asset_id and "name" in parameters:
        existing = check_asset_exists(project_id, "character", parameters["name"])
        if existing:
            asset_id = existing["asset_id"]
        else:
            return {"success": False, "error": f"未找到角色: {parameters['name']}"}
    if not asset_id:
        return {"success": False, "error": "需要提供 name 或 asset_id"}
    current = AssetService.load_asset(project_id, "character", asset_id)
    if not current:
        return {"success": False, "error": "角色不存在"}
    if "description" in parameters and parameters["description"]:
        current["description"] = parameters["description"]
    for key in ["gender", "age", "appearance", "personality", "background", "image_prompt"]:
        if key in parameters and parameters[key]:
            current[key] = parameters[key]
    current["updated_at"] = datetime.now().isoformat()
    result = AssetService.save_asset(project_id, "character", current)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}


async def handle_update_scene(project_id: str, parameters: Dict) -> Dict:
    asset_id = parameters.get("asset_id")
    if not asset_id and "name" in parameters:
        existing = check_asset_exists(project_id, "scene", parameters["name"])
        if existing:
            asset_id = existing["asset_id"]
        else:
            return {"success": False, "error": f"未找到场景: {parameters['name']}"}
    if not asset_id:
        return {"success": False, "error": "需要提供 name 或 asset_id"}
    current = AssetService.load_asset(project_id, "scene", asset_id)
    if not current:
        return {"success": False, "error": "场景不存在"}
    if "description" in parameters and parameters["description"]:
        current["description"] = parameters["description"]
    for key in ["location", "time_of_day", "weather", "mood", "image_prompt"]:
        if key in parameters and parameters[key]:
            current[key] = parameters[key]
    current["updated_at"] = datetime.now().isoformat()
    result = AssetService.save_asset(project_id, "scene", current)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}


async def handle_update_prop(project_id: str, parameters: Dict) -> Dict:
    asset_id = parameters.get("asset_id")
    if not asset_id and "name" in parameters:
        existing = check_asset_exists(project_id, "prop", parameters["name"])
        if existing:
            asset_id = existing["asset_id"]
        else:
            return {"success": False, "error": f"未找到道具: {parameters['name']}"}
    if not asset_id:
        return {"success": False, "error": "需要提供 name 或 asset_id"}
    current = AssetService.load_asset(project_id, "prop", asset_id)
    if not current:
        return {"success": False, "error": "道具不存在"}
    if "description" in parameters and parameters["description"]:
        current["description"] = parameters["description"]
    for key in ["category", "era", "material", "image_prompt"]:
        if key in parameters and parameters[key]:
            current[key] = parameters[key]
    current["updated_at"] = datetime.now().isoformat()
    result = AssetService.save_asset(project_id, "prop", current)
    return {"success": True, "asset_id": result["asset_id"], "name": result["name"], "updated": True}


async def handle_update_episode(project_id: str, parameters: Dict) -> Dict:
    asset_id = parameters.get("asset_id")
    if not asset_id and "episode_number" in parameters:
        for ep in AssetService.list_assets(project_id, "episode"):
            if ep.get("episode_number") == parameters["episode_number"]:
                asset_id = ep["asset_id"]
                break
        if not asset_id:
            return {"success": False, "error": f"未找到第{parameters['episode_number']}集"}
    if not asset_id:
        return {"success": False, "error": "需要提供 episode_number 或 asset_id"}
    current = AssetService.load_asset(project_id, "episode", asset_id)
    if not current:
        return {"success": False, "error": "剧集不存在"}
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


async def handle_create_child_asset(project_id: str, parameters: Dict) -> Dict:
    for field in ["asset_type", "parent_id", "name", "description"]:
        if field not in parameters:
            return {"success": False, "error": f"缺少必需字段: {field}"}
    asset_type = parameters["asset_type"]
    if asset_type not in ["character", "scene", "prop"]:
        return {"success": False, "error": f"不支持的资产类型: {asset_type}"}
    try:
        child_asset = AssetService.create_child_asset(
            project_id, asset_type, parameters["parent_id"],
            {"name": parameters["name"], "description": parameters["description"],
             "variant_info": parameters.get("variant_info", ""), "created_at": datetime.now().isoformat()}
        )
        return {"success": True, "asset_id": child_asset["asset_id"], "name": child_asset["name"], "parent_id": child_asset.get("parent_id")}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": f"创建子资产失败: {str(e)}"}
