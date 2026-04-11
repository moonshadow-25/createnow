"""查询工具执行逻辑"""
from typing import Dict
from app.services import AssetService
from .helpers import check_asset_exists, KEY_ALIASES


async def handle_list_assets(project_id: str, parameters: Dict) -> Dict:
    if "asset_type" not in parameters:
        return {"success": False, "error": "缺少必需字段: asset_type"}
    asset_type = parameters["asset_type"]
    if asset_type not in ["character", "scene", "prop", "episode"]:
        return {"success": False, "error": f"不支持的资产类型: {asset_type}"}
    try:
        assets = AssetService.list_assets(project_id, asset_type)
        return {"success": True, "asset_type": asset_type, "count": len(assets), "assets": assets}
    except Exception as e:
        return {"success": False, "error": f"列出资产失败: {str(e)}"}


async def handle_get_asset(project_id: str, parameters: Dict) -> Dict:
    if "asset_type" not in parameters:
        return {"success": False, "error": "缺少必需字段: asset_type"}
    asset_type = parameters["asset_type"]
    if asset_type not in ["character", "scene", "prop", "episode"]:
        return {"success": False, "error": f"不支持的资产类型: {asset_type}"}
    try:
        asset_id = parameters.get("asset_id")
        if not asset_id and "name" in parameters:
            existing = check_asset_exists(project_id, asset_type, parameters["name"])
            if existing:
                asset_id = existing["asset_id"]
            else:
                return {"success": False, "error": f"未找到资产: {parameters['name']}"}
        if not asset_id:
            return {"success": False, "error": "需要提供 asset_id 或 name"}
        asset = AssetService.load_asset(project_id, asset_type, asset_id)
        if not asset:
            return {"success": False, "error": "资产不存在"}
        return {"success": True, "asset": asset}
    except Exception as e:
        return {"success": False, "error": f"获取资产失败: {str(e)}"}


async def handle_list_storyboards(project_id: str, parameters: Dict) -> Dict:
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    try:
        storyboards = AssetService.list_assets(project_id, "storyboard")
        episode_storyboards = sorted(
            [sb for sb in storyboards if sb.get("episode_id") == parameters["episode_id"]],
            key=lambda x: x.get("sequence", 0)
        )
        return {"success": True, "episode_id": parameters["episode_id"], "count": len(episode_storyboards), "storyboards": episode_storyboards}
    except Exception as e:
        return {"success": False, "error": f"列出分镜失败: {str(e)}"}


async def handle_get_storyboard(project_id: str, parameters: Dict) -> Dict:
    try:
        storyboard_id = parameters.get("storyboard_id")
        if not storyboard_id and "episode_id" in parameters and "sequence" in parameters:
            for sb in AssetService.list_assets(project_id, "storyboard"):
                if sb.get("episode_id") == parameters["episode_id"] and sb.get("sequence") == parameters["sequence"]:
                    storyboard_id = sb["asset_id"]
                    break
            if not storyboard_id:
                return {"success": False, "error": f"未找到分镜: 第{parameters['sequence']}镜"}
        if not storyboard_id:
            return {"success": False, "error": "需要提供 storyboard_id 或 (episode_id + sequence)"}
        storyboard = AssetService.load_asset(project_id, "storyboard", storyboard_id)
        if not storyboard:
            return {"success": False, "error": "分镜不存在"}
        return {"success": True, "storyboard": storyboard}
    except Exception as e:
        return {"success": False, "error": f"获取分镜失败: {str(e)}"}


async def handle_get_project_config(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        ai_cfg = proj.get("ai_config", {}) if proj else {}
        global_style = ai_cfg.get("global_style_config", {})
        return {"success": True, "global_style_config": global_style}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_ai_instructions(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        instructions = proj.get("ai_instructions", "") if proj else ""
        return {"success": True, "ai_instructions": instructions or "（暂无自定义指令）"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_prompt_template(project_id: str, parameters: Dict) -> Dict:
    try:
        from app.services.global_prompt_service import get_prompt_content, load_prompts
        from app.services import ProjectService
        proj = ProjectService.get_project(project_id)
        ai_cfg = proj.get("ai_config", {}) if proj else {}
        key = KEY_ALIASES.get(parameters.get("key", ""), parameters.get("key", ""))
        content = get_prompt_content(key, ai_cfg)
        prompts = load_prompts()
        label = prompts.get(key, {}).get("label", key)
        default_preset = prompts.get(key, {}).get("presets", {}).get("default", {})
        variables = default_preset.get("variables", [])
        return {"success": True, "key": key, "label": label, "content": content or "（模板不存在）", "variables": variables}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_list_all_assets(project_id: str, parameters: Dict) -> Dict:
    """懒查询：获取项目所有资产列表（角色/场景/道具/剧集）"""
    try:
        result = {}
        for asset_type in ["character", "scene", "prop", "episode"]:
            assets = AssetService.list_assets(project_id, asset_type) or []
            result[asset_type] = [
                {"asset_id": a.get("asset_id"), "name": a.get("name"), "description": (a.get("description") or "")[:80]}
                for a in assets
            ]
        return {"success": True, **result}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_episode_storyboards(project_id: str, parameters: Dict) -> Dict:
    """懒查询：获取指定剧集的完整分镜列表"""
    if "episode_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    try:
        storyboards = AssetService.list_assets(project_id, "storyboard") or []
        episode_storyboards = sorted(
            [sb for sb in storyboards if sb.get("episode_id") == parameters["episode_id"]],
            key=lambda x: x.get("sequence", 0)
        )
        return {"success": True, "episode_id": parameters["episode_id"], "count": len(episode_storyboards), "storyboards": episode_storyboards}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_get_episode_script(project_id: str, parameters: Dict) -> Dict:
    """读取当前剧集的完整剧本内容"""
    episode_id = parameters.get("episode_id")
    if not episode_id:
        return {"success": False, "error": "缺少必需字段: episode_id"}
    try:
        episode = AssetService.load_asset(project_id, "episode", episode_id)
        if not episode:
            return {"success": False, "error": "剧集不存在"}
        script = episode.get("script", "")
        return {"success": True, "episode_id": episode_id, "script": script or "（暂无剧本内容）"}
    except Exception as e:
        return {"success": False, "error": str(e)}
