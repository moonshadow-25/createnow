"""剧本工具执行逻辑"""
import re
from typing import Dict
from app.services import ScriptService, ScriptParser


async def handle_create_script(project_id: str, parameters: Dict) -> Dict:
    if "title" not in parameters:
        return {"success": False, "error": "缺少必需字段: title"}
    try:
        script = ScriptService.create_script(project_id, title=parameters["title"], description=parameters.get("description", ""))
        import_result = None
        if parameters.get("content"):
            import_result = ScriptParser.import_script_to_project(project_id, script["script_id"], parameters["content"])
        result = {"success": True, "script_id": script["script_id"], "title": script["title"], "message": f"已创建剧本: {script['title']}"}
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
        return {"success": False, "error": f"创建剧本失败: {str(e)}"}


async def handle_import_script_content(project_id: str, parameters: Dict) -> Dict:
    if "script_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: script_id"}
    if "content" not in parameters:
        return {"success": False, "error": "缺少必需字段: content"}
    try:
        result = ScriptParser.import_script_to_project(project_id, parameters["script_id"], parameters["content"])
        message = f"导入成功！标题: {result.get('title', '')}, 人物: {result.get('characters_count', 0)}, 集数: {result.get('episodes_count', 0)}, 场景: {result.get('scenes_count', 0)}"
        if result.get("warnings"):
            message += f"。注意：{'; '.join(result['warnings'][:2])}"
        return {"success": result.get("success", True), "import_result": result, "message": message}
    except Exception as e:
        return {"success": False, "error": f"导入剧本失败: {str(e)}"}


async def handle_add_script_character(project_id: str, parameters: Dict) -> Dict:
    if "script_id" not in parameters:
        return {"success": False, "error": "缺少必需字段: script_id"}
    if "name" not in parameters:
        return {"success": False, "error": "缺少必需字段: name"}
    try:
        from app.services.script_service import ScriptCharacterService
        character = ScriptCharacterService.add_character(
            project_id, parameters["script_id"],
            {"name": parameters["name"], "age": parameters.get("age"), "gender": parameters.get("gender"),
             "description": parameters.get("description", ""), "notes": parameters.get("notes", "")}
        )
        return {"success": True, "character_id": character["character_id"], "name": character["name"], "message": f"已添加剧本人物: {character['name']}"}
    except Exception as e:
        return {"success": False, "error": f"添加人物失败: {str(e)}"}


async def handle_add_script_scene(project_id: str, parameters: Dict) -> Dict:
    for field in ["script_id", "episode_number", "location", "content"]:
        if field not in parameters:
            return {"success": False, "error": f"缺少必需字段: {field}"}
    try:
        from app.services.script_service import ScriptEpisodeService, ScriptSceneService, ScriptLineService
        episodes = ScriptEpisodeService.list_episodes(project_id, parameters["script_id"])
        episode = next((ep for ep in episodes if ep["episode_number"] == parameters["episode_number"]), None)
        if not episode:
            episode = ScriptEpisodeService.add_episode(project_id, parameters["script_id"], parameters["episode_number"])

        content = parameters["content"]
        lines = []
        scene_sequence = 1
        scene_header_pattern = re.compile(r'^([一二三四五六七八九十]+)、(.+?)\s+(日|夜)\s+(内|外)')
        visual_pattern = re.compile(r'^△\s*(.+)$')
        current_scene = None

        for line in content.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
            scene_match = scene_header_pattern.match(line)
            if scene_match:
                if current_scene:
                    lines.append(current_scene)
                current_scene = {"episode_id": episode["episode_id"], "sequence": scene_sequence,
                                 "location": scene_match.group(2).strip(), "time_of_day": scene_match.group(3),
                                 "interior_exterior": scene_match.group(4), "lines": []}
                scene_sequence += 1
                continue
            if current_scene:
                visual_match = visual_pattern.match(line)
                if visual_match:
                    current_scene["lines"].append({"line_type": "visual", "sequence": len(current_scene["lines"]) + 1, "content": line, "visual_description": visual_match.group(1).strip()})
                else:
                    dialogue_match = re.match(r'^([^（:]+)(?:（([^）]+)）)?[:：](.+)', line)
                    if dialogue_match:
                        current_scene["lines"].append({"line_type": "dialogue", "sequence": len(current_scene["lines"]) + 1, "content": line,
                                                        "character": dialogue_match.group(1).strip(), "parenthetical": dialogue_match.group(2), "dialogue": dialogue_match.group(3).strip()})
                    else:
                        current_scene["lines"].append({"line_type": "action", "sequence": len(current_scene["lines"]) + 1, "content": line, "visual_description": line})
        if current_scene:
            lines.append(current_scene)

        for scene_data in lines:
            scene = ScriptSceneService.add_scene(project_id, parameters["script_id"], episode["episode_id"],
                                                  {"sequence": scene_data["sequence"], "location": scene_data["location"],
                                                   "time_of_day": scene_data["time_of_day"], "interior_exterior": scene_data["interior_exterior"], "content": ""})
            for line_data in scene_data.get("lines", []):
                ScriptLineService.add_line(project_id, parameters["script_id"], scene["scene_id"],
                                           {"line_type": line_data["line_type"], "content": line_data["content"], "sequence": line_data["sequence"],
                                            "character": line_data.get("character"), "parenthetical": line_data.get("parenthetical"),
                                            "dialogue": line_data.get("dialogue"), "visual_description": line_data.get("visual_description")})

        return {"success": True, "episode_number": parameters["episode_number"], "scenes_count": len(lines), "message": f"已添加 {len(lines)} 个场景到第{parameters['episode_number']}集"}
    except Exception as e:
        return {"success": False, "error": f"添加场景失败: {str(e)}"}
