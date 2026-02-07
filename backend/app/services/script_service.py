"""剧本创作服务"""
import json
import uuid
import re
from pathlib import Path
from typing import List, Dict, Optional, Any
from datetime import datetime

from app.models.project import Script, ScriptCharacter, ScriptEpisode, ScriptScene, ShotLine
from app.core.config import settings


# 中文数字映射
CHINESE_NUMBERS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九",
                   "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"]


def chinese_to_number(chinese: str) -> int:
    """将中文数字转换为阿拉伯数字"""
    if chinese in CHINESE_NUMBERS:
        return CHINESE_NUMBERS.index(chinese)
    # 尝试解析更复杂的中文数字
    match = re.match(r'^([一二三四五六七八九十]+)$', chinese)
    if match:
        cn = match.group(1)
        if cn == "十":
            return 10
        elif cn.startswith("十"):
            # 十一、十二等
            if len(cn) == 2:
                return 10 + CHINESE_NUMBERS.index(cn[1]) if cn[1] in CHINESE_NUMBERS else 10
            return 10
        else:
            return CHINESE_NUMBERS.index(cn) if cn in CHINESE_NUMBERS else 0
    return 0


def number_to_chinese(num: int) -> str:
    """将阿拉伯数字转换为中文数字"""
    if 1 <= num <= 20:
        return CHINESE_NUMBERS[num]
    # 对于更大的数字，简单返回阿拉伯数字
    return str(num)


class ScriptService:
    """剧本管理服务"""

    @staticmethod
    def _get_script_dir(project_id: str, script_id: str) -> Path:
        """获取剧本目录"""
        project_dir = settings.PROJECTS_DIR / project_id
        script_dir = project_dir / "scripts" / script_id
        script_dir.mkdir(parents=True, exist_ok=True)
        return script_dir

    @staticmethod
    def create_script(project_id: str, title: str = "未命名剧本", description: str = "") -> Dict:
        """创建剧本"""
        script_id = str(uuid.uuid4())
        script = {
            "script_id": script_id,
            "title": title,
            "description": description,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        script_dir = ScriptService._get_script_dir(project_id, script_id)
        script_file = script_dir / "script.json"
        with open(script_file, "w", encoding="utf-8") as f:
            json.dump(script, f, ensure_ascii=False, indent=2)

        # 创建子目录
        (script_dir / "characters").mkdir(exist_ok=True)
        (script_dir / "episodes").mkdir(exist_ok=True)
        (script_dir / "scenes").mkdir(exist_ok=True)
        (script_dir / "lines").mkdir(exist_ok=True)

        return script

    @staticmethod
    def get_script(project_id: str, script_id: str) -> Optional[Dict]:
        """获取剧本"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        script_file = script_dir / "script.json"

        if not script_file.exists():
            return None

        with open(script_file, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def list_scripts(project_id: str) -> List[Dict]:
        """列出项目所有剧本"""
        project_dir = settings.PROJECTS_DIR / project_id
        scripts_dir = project_dir / "scripts"

        if not scripts_dir.exists():
            return []

        scripts = []
        for script_dir in scripts_dir.iterdir():
            if script_dir.is_dir():
                script_file = script_dir / "script.json"
                if script_file.exists():
                    with open(script_file, "r", encoding="utf-8") as f:
                        scripts.append(json.load(f))

        scripts.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return scripts

    @staticmethod
    def update_script(project_id: str, script_id: str, **kwargs) -> Optional[Dict]:
        """更新剧本"""
        script = ScriptService.get_script(project_id, script_id)
        if not script:
            return None

        if "title" in kwargs:
            script["title"] = kwargs["title"]
        if "description" in kwargs:
            script["description"] = kwargs["description"]

        script["updated_at"] = datetime.now().isoformat()

        script_dir = ScriptService._get_script_dir(project_id, script_id)
        script_file = script_dir / "script.json"
        with open(script_file, "w", encoding="utf-8") as f:
            json.dump(script, f, ensure_ascii=False, indent=2)

        return script

    @staticmethod
    def delete_script(project_id: str, script_id: str) -> bool:
        """删除剧本"""
        project_dir = settings.PROJECTS_DIR / project_id
        script_dir = project_dir / "scripts" / script_id

        if script_dir.exists():
            import shutil
            shutil.rmtree(script_dir)
            return True
        return False

    @staticmethod
    def get_script_full_content(project_id: str, script_id: str) -> str:
        """获取剧本完整文本内容（用于导出）"""
        script = ScriptService.get_script(project_id, script_id)
        if not script:
            return ""

        # 获取人物表
        characters = ScriptService.list_characters(project_id, script_id)

        # 获取所有剧集
        episodes = ScriptService.list_episodes(project_id, script_id)

        # 构建文本
        lines = []
        lines.append(f"《{script['title']}》")
        lines.append("人物表：")
        for char in characters:
            char_desc = f"{char['name']}："
            if char.get('age'):
                char_desc += f"{char['age']}，"
            if char.get('gender'):
                char_desc += f"{char['gender']}，"
            char_desc += char.get('description', char.get('notes', ''))
            lines.append(char_desc)
        lines.append("")

        # 获取剧集和场景
        for episode in sorted(episodes, key=lambda x: x.get('episode_number', 0)):
            lines.append(f"第{episode['episode_number']}集")

            scenes = ScriptService.list_scenes_by_episode(project_id, episode['episode_id'])
            for scene in sorted(scenes, key=lambda x: x.get('sequence', 0)):
                # 获取场景的所有行
                scene_lines = ScriptService.list_lines_by_scene(project_id, scene['scene_id'])
                for line in sorted(scene_lines, key=lambda x: x.get('sequence', 0)):
                    lines.append(line.get('content', ''))

            lines.append("")  # 集间空行

        return "\n".join(lines)


class ScriptCharacterService:
    """剧本人物服务"""

    @staticmethod
    def add_character(project_id: str, script_id: str, character_data: Dict) -> Dict:
        """添加人物"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        char_dir = script_dir / "characters"
        char_dir.mkdir(exist_ok=True)

        character_id = character_data.get("character_id") or str(uuid.uuid4())
        character = {
            "character_id": character_id,
            "script_id": script_id,
            "name": character_data.get("name", ""),
            "age": character_data.get("age"),
            "gender": character_data.get("gender"),
            "description": character_data.get("description", ""),
            "notes": character_data.get("notes", ""),
            "created_at": datetime.now().isoformat()
        }

        char_file = char_dir / f"{character_id}.json"
        with open(char_file, "w", encoding="utf-8") as f:
            json.dump(character, f, ensure_ascii=False, indent=2)

        # 更新剧本更新时间
        ScriptService.update_script(project_id, script_id)

        return character

    @staticmethod
    def list_characters(project_id: str, script_id: str) -> List[Dict]:
        """列出剧本人物"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        char_dir = script_dir / "characters"

        if not char_dir.exists():
            return []

        characters = []
        for char_file in char_dir.glob("*.json"):
            with open(char_file, "r", encoding="utf-8") as f:
                characters.append(json.load(f))

        characters.sort(key=lambda x: x.get("created_at", ""))
        return characters

    @staticmethod
    def get_character(project_id: str, script_id: str, character_id: str) -> Optional[Dict]:
        """获取人物"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        char_file = script_dir / "characters" / f"{character_id}.json"

        if char_file.exists():
            with open(char_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    @staticmethod
    def update_character(project_id: str, script_id: str, character_id: str, **kwargs) -> Optional[Dict]:
        """更新人物"""
        character = ScriptCharacterService.get_character(project_id, script_id, character_id)
        if not character:
            return None

        if "name" in kwargs:
            character["name"] = kwargs["name"]
        if "age" in kwargs:
            character["age"] = kwargs["age"]
        if "gender" in kwargs:
            character["gender"] = kwargs["gender"]
        if "description" in kwargs:
            character["description"] = kwargs["description"]
        if "notes" in kwargs:
            character["notes"] = kwargs["notes"]

        script_dir = ScriptService._get_script_dir(project_id, script_id)
        char_file = script_dir / "characters" / f"{character_id}.json"
        with open(char_file, "w", encoding="utf-8") as f:
            json.dump(character, f, ensure_ascii=False, indent=2)

        ScriptService.update_script(project_id, script_id)
        return character

    @staticmethod
    def delete_character(project_id: str, script_id: str, character_id: str) -> bool:
        """删除人物"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        char_file = script_dir / "characters" / f"{character_id}.json"

        if char_file.exists():
            char_file.unlink()
            ScriptService.update_script(project_id, script_id)
            return True
        return False


class ScriptEpisodeService:
    """剧本剧集服务"""

    @staticmethod
    def add_episode(project_id: str, script_id: str, episode_number: int, title: str = "") -> Dict:
        """添加剧集"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        episode_dir = script_dir / "episodes"
        episode_dir.mkdir(exist_ok=True)

        episode_id = str(uuid.uuid4())
        episode = {
            "episode_id": episode_id,
            "script_id": script_id,
            "episode_number": episode_number,
            "title": title,
            "created_at": datetime.now().isoformat()
        }

        episode_file = episode_dir / f"{episode_id}.json"
        with open(episode_file, "w", encoding="utf-8") as f:
            json.dump(episode, f, ensure_ascii=False, indent=2)

        ScriptService.update_script(project_id, script_id)
        return episode

    @staticmethod
    def list_episodes(project_id: str, script_id: str) -> List[Dict]:
        """列出剧集"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        episode_dir = script_dir / "episodes"

        if not episode_dir.exists():
            return []

        episodes = []
        for episode_file in episode_dir.glob("*.json"):
            with open(episode_file, "r", encoding="utf-8") as f:
                episodes.append(json.load(f))

        episodes.sort(key=lambda x: x.get("episode_number", 0))
        return episodes

    @staticmethod
    def get_episode(project_id: str, script_id: str, episode_id: str) -> Optional[Dict]:
        """获取剧集"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        episode_file = script_dir / "episodes" / f"{episode_id}.json"

        if episode_file.exists():
            with open(episode_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    @staticmethod
    def delete_episode(project_id: str, script_id: str, episode_id: str) -> bool:
        """删除剧集（级联删除场景）"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)

        # 先删除所有关联场景
        scenes = ScriptSceneService.list_scenes_by_episode(project_id, episode_id)
        for scene in scenes:
            ScriptSceneService.delete_scene(project_id, script_id, scene["scene_id"])

        episode_file = script_dir / "episodes" / f"{episode_id}.json"
        if episode_file.exists():
            episode_file.unlink()
            ScriptService.update_script(project_id, script_id)
            return True
        return False


class ScriptSceneService:
    """剧本场景服务"""

    @staticmethod
    def add_scene(project_id: str, script_id: str, episode_id: str, scene_data: Dict) -> Dict:
        """添加场景"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        scene_dir = script_dir / "scenes"
        scene_dir.mkdir(exist_ok=True)

        scene_id = str(uuid.uuid4())
        scene = {
            "scene_id": scene_id,
            "episode_id": episode_id,
            "sequence": scene_data.get("sequence", 1),
            "location": scene_data.get("location", ""),
            "time_of_day": scene_data.get("time_of_day", "日"),
            "interior_exterior": scene_data.get("interior_exterior", "外"),
            "content": scene_data.get("content", ""),
            "created_at": datetime.now().isoformat()
        }

        scene_file = scene_dir / f"{scene_id}.json"
        with open(scene_file, "w", encoding="utf-8") as f:
            json.dump(scene, f, ensure_ascii=False, indent=2)

        ScriptService.update_script(project_id, script_id)
        return scene

    @staticmethod
    def list_scenes_by_episode(project_id: str, episode_id: str) -> List[Dict]:
        """列出剧集的所有场景"""
        # 需要遍历所有剧本目录查找场景
        project_dir = settings.PROJECTS_DIR / project_id
        scripts_dir = project_dir / "scripts"

        scenes = []
        if scripts_dir.exists():
            for script_dir in scripts_dir.iterdir():
                if script_dir.is_dir():
                    scene_dir = script_dir / "scenes"
                    if scene_dir.exists():
                        for scene_file in scene_dir.glob("*.json"):
                            with open(scene_file, "r", encoding="utf-8") as f:
                                scene = json.load(f)
                                if scene.get("episode_id") == episode_id:
                                    scenes.append(scene)

        scenes.sort(key=lambda x: x.get("sequence", 0))
        return scenes

    @staticmethod
    def get_scene(project_id: str, script_id: str, scene_id: str) -> Optional[Dict]:
        """获取场景"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        scene_file = script_dir / "scenes" / f"{scene_id}.json"

        if scene_file.exists():
            with open(scene_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    @staticmethod
    def update_scene(project_id: str, script_id: str, scene_id: str, **kwargs) -> Optional[Dict]:
        """更新场景"""
        scene = ScriptSceneService.get_scene(project_id, script_id, scene_id)
        if not scene:
            return None

        if "location" in kwargs:
            scene["location"] = kwargs["location"]
        if "time_of_day" in kwargs:
            scene["time_of_day"] = kwargs["time_of_day"]
        if "interior_exterior" in kwargs:
            scene["interior_exterior"] = kwargs["interior_exterior"]
        if "content" in kwargs:
            scene["content"] = kwargs["content"]
        if "sequence" in kwargs:
            scene["sequence"] = kwargs["sequence"]

        script_dir = ScriptService._get_script_dir(project_id, script_id)
        scene_file = script_dir / "scenes" / f"{scene_id}.json"
        with open(scene_file, "w", encoding="utf-8") as f:
            json.dump(scene, f, ensure_ascii=False, indent=2)

        ScriptService.update_script(project_id, script_id)
        return scene

    @staticmethod
    def delete_scene(project_id: str, script_id: str, scene_id: str) -> bool:
        """删除场景（级联删除镜头行）"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)

        # 删除所有关联的镜头行
        lines = ScriptLineService.list_lines_by_scene(project_id, scene_id)
        for line in lines:
            ScriptLineService.delete_line(project_id, script_id, line["line_id"])

        scene_file = script_dir / "scenes" / f"{scene_id}.json"
        if scene_file.exists():
            scene_file.unlink()
            ScriptService.update_script(project_id, script_id)
            return True
        return False


class ScriptLineService:
    """镜头行服务"""

    @staticmethod
    def add_line(project_id: str, script_id: str, scene_id: str, line_data: Dict) -> Dict:
        """添加镜头行"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        line_dir = script_dir / "lines"
        line_dir.mkdir(exist_ok=True)

        line_id = str(uuid.uuid4())
        line = {
            "line_id": line_id,
            "scene_id": scene_id,
            "line_type": line_data.get("line_type", "visual"),
            "sequence": line_data.get("sequence", 1),
            "content": line_data.get("content", ""),
            "character": line_data.get("character"),
            "parenthetical": line_data.get("parenthetical"),
            "dialogue": line_data.get("dialogue"),
            "visual_type": line_data.get("visual_type"),
            "visual_description": line_data.get("visual_description"),
            "created_at": datetime.now().isoformat()
        }

        line_file = line_dir / f"{line_id}.json"
        with open(line_file, "w", encoding="utf-8") as f:
            json.dump(line, f, ensure_ascii=False, indent=2)

        ScriptService.update_script(project_id, script_id)
        return line

    @staticmethod
    def list_lines_by_scene(project_id: str, scene_id: str) -> List[Dict]:
        """列出场景的所有镜头行"""
        project_dir = settings.PROJECTS_DIR / project_id
        scripts_dir = project_dir / "scripts"

        lines = []
        if scripts_dir.exists():
            for script_dir in scripts_dir.iterdir():
                if script_dir.is_dir():
                    line_dir = script_dir / "lines"
                    if line_dir.exists():
                        for line_file in line_dir.glob("*.json"):
                            with open(line_file, "r", encoding="utf-8") as f:
                                line = json.load(f)
                                if line.get("scene_id") == scene_id:
                                    lines.append(line)

        lines.sort(key=lambda x: x.get("sequence", 0))
        return lines

    @staticmethod
    def get_line(project_id: str, script_id: str, line_id: str) -> Optional[Dict]:
        """获取镜头行"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        line_file = script_dir / "lines" / f"{line_id}.json"

        if line_file.exists():
            with open(line_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    @staticmethod
    def update_line(project_id: str, script_id: str, line_id: str, **kwargs) -> Optional[Dict]:
        """更新镜头行"""
        line = ScriptLineService.get_line(project_id, script_id, line_id)
        if not line:
            return None

        if "content" in kwargs:
            line["content"] = kwargs["content"]
        if "line_type" in kwargs:
            line["line_type"] = kwargs["line_type"]
        if "character" in kwargs:
            line["character"] = kwargs["character"]
        if "parenthetical" in kwargs:
            line["parenthetical"] = kwargs["parenthetical"]
        if "dialogue" in kwargs:
            line["dialogue"] = kwargs["dialogue"]
        if "visual_type" in kwargs:
            line["visual_type"] = kwargs["visual_type"]
        if "visual_description" in kwargs:
            line["visual_description"] = kwargs["visual_description"]
        if "sequence" in kwargs:
            line["sequence"] = kwargs["sequence"]

        script_dir = ScriptService._get_script_dir(project_id, script_id)
        line_file = script_dir / "lines" / f"{line_id}.json"
        with open(line_file, "w", encoding="utf-8") as f:
            json.dump(line, f, ensure_ascii=False, indent=2)

        ScriptService.update_script(project_id, script_id)
        return line

    @staticmethod
    def delete_line(project_id: str, script_id: str, line_id: str) -> bool:
        """删除镜头行"""
        script_dir = ScriptService._get_script_dir(project_id, script_id)
        line_file = script_dir / "lines" / f"{line_id}.json"

        if line_file.exists():
            line_file.unlink()
            ScriptService.update_script(project_id, script_id)
            return True
        return False


class ScriptParser:
    """剧本解析器 - 解析剧本文本为结构化数据"""

    # 场景头正则：一、场景名  日  外（中文数字，严格格式）
    SCENE_HEADER_PATTERN_STRICT = re.compile(r'^([一二三四五六七八九十]+)、(.+?)\s+(日|夜)\s+(内|外)')

    # 场景头正则：1. 场景名 日 外（阿拉伯数字，容错格式）
    SCENE_HEADER_PATTERN_LOOSE = re.compile(r'^(\d+)[.、.](.+?)\s+(日|夜|黎明|黄昏|清晨|傍晚)\s*(内|外)')

    # 场景头正则：场景1 日 外（更宽松格式）
    SCENE_HEADER_PATTERN_ALT = re.compile(r'^场景\s*(\d+)[：:]\s*(.+?)\s+(日|夜|黎明|黄昏|清晨|傍晚)\s*(内|外)')

    # 视觉镜头正则：△ 开头
    VISUAL_SHOT_PATTERN = re.compile(r'^△\s*(.+)$')

    # 视觉镜头容错：[视觉] 或 [镜头] 开头
    VISUAL_SHOT_PATTERN_ALT = re.compile(r'^[【\[]\s*(?:视觉|镜头|画面)\s*[】\]]\s*[:：]?\s*(.+)$')

    # 对话正则：角色名（内容）：台词
    DIALOGUE_PATTERN = re.compile(r'^([^（:]+)(?:（([^）]+)）)?[:：](.+)$')

    # 角色提取正则
    CHARACTER_PATTERN = re.compile(r'^([^\s:：（:]+)[：:]?\s*(.+)?$')

    # 集数正则：第1集、第一集、Episode 1
    EPISODE_PATTERN = re.compile(r'^第?(\d+)[集话]|[集话]?\s*[：:]?\s*第\s*(\d+)[集话]|Episode\s*(\d+)', re.IGNORECASE)

    @staticmethod
    def parse_script_text(text: str) -> Dict[str, Any]:
        """解析剧本文本，支持多种格式变体

        返回结构：
        {
            "title": "剧名",
            "characters": [{"name": "", "age": "", "gender": "", "description": ""}],
            "episodes": [{
                "episode_number": 1,
                "title": "",
                "scenes": [{
                    "sequence": 1,
                    "location": "",
                    "time_of_day": "日",
                    "interior_exterior": "外",
                    "lines": [...]
                }]
            }],
            "warnings": [],
            "unparsed_lines": []
        }
        """
        lines = text.strip().split('\n')

        result = {
            "title": "",
            "characters": [],
            "episodes": [],
            "warnings": [],
            "unparsed_lines": []
        }

        current_episode = None
        current_scene = None
        line_sequence = 0
        scene_sequence = 0

        # 用于追踪未解析的行
        parsed_line_indices = set()

        # 第一阶段：提取剧名和人物表
        header_complete = False
        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue

            # 提取剧名 - 支持《》和【】格式
            if (line.startswith("《") and line.endswith("》")) or (line.startswith("【") and line.endswith("】")):
                result["title"] = line[1:-1]
                parsed_line_indices.add(i)
                continue

            # 人物表开始 - 支持"人物表："或"角色表："或"人物："
            if line in ["人物表：", "角色表：", "人物：", "角色："]:
                parsed_line_indices.add(i)
                # 继续读取人物
                for j in range(i + 1, len(lines)):
                    char_line = lines[j].strip()
                    if not char_line:
                        continue
                    # 检查是否是集数开始
                    if ScriptParser.EPISODE_PATTERN.match(char_line):
                        header_complete = True
                        break
                    # 解析人物
                    character = ScriptParser._parse_character_line(char_line)
                    if character:
                        result["characters"].append(character)
                        parsed_line_indices.add(j)
                continue

            # 检查是否是集数开始
            episode_match = ScriptParser.EPISODE_PATTERN.match(line)
            if episode_match:
                header_complete = True
                break

        # 第二阶段：解析集数和场景
        in_header = not header_complete
        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue

            # 跳过头部内容
            if in_header:
                if ScriptParser.EPISODE_PATTERN.match(line):
                    in_header = False
                    parsed_line_indices.add(i)
                else:
                    continue

            # 解析集数 - 支持多种格式
            episode_match = ScriptParser.EPISODE_PATTERN.match(line)
            if episode_match:
                # 提取集数
                episode_number = None
                for group in episode_match.groups():
                    if group:
                        episode_number = int(group)
                        break
                if not episode_number:
                    episode_number = int(episode_match.group(1))

                current_episode = {
                    "episode_number": episode_number,
                    "title": "",
                    "scenes": []
                }
                result["episodes"].append(current_episode)
                current_scene = None
                line_sequence = 0
                parsed_line_indices.add(i)
                continue

            # 解析场景头 - 尝试多种格式
            scene_match = None
            scene_data = None

            # 优先尝试严格格式
            scene_match = ScriptParser.SCENE_HEADER_PATTERN_STRICT.match(line)
            if scene_match:
                scene_data = {
                    "sequence": scene_sequence + 1,
                    "location": scene_match.group(2).strip(),
                    "time_of_day": scene_match.group(3),
                    "interior_exterior": scene_match.group(4)
                }
            else:
                # 尝试宽松格式（阿拉伯数字）
                scene_match = ScriptParser.SCENE_HEADER_PATTERN_LOOSE.match(line)
                if scene_match:
                    scene_data = {
                        "sequence": scene_sequence + 1,
                        "location": scene_match.group(2).strip(),
                        "time_of_day": scene_match.group(3),
                        "interior_exterior": scene_match.group(4)
                    }
                else:
                    # 尝试替代格式
                    scene_match = ScriptParser.SCENE_HEADER_PATTERN_ALT.match(line)
                    if scene_match:
                        scene_data = {
                            "sequence": int(scene_match.group(1)),
                            "location": scene_match.group(2).strip(),
                            "time_of_day": scene_match.group(3),
                            "interior_exterior": scene_match.group(4)
                        }

            if scene_data:
                scene_sequence = scene_data["sequence"]
                line_sequence = 0
                current_scene = {
                    "sequence": scene_sequence,
                    "location": scene_data["location"],
                    "time_of_day": scene_data["time_of_day"],
                    "interior_exterior": scene_data["interior_exterior"],
                    "lines": []
                }
                if current_episode:
                    current_episode["scenes"].append(current_scene)
                parsed_line_indices.add(i)
                continue

            # 解析行内容
            if current_scene:
                parsed_line = ScriptParser._parse_line(line, line_sequence)
                if parsed_line:
                    current_scene["lines"].append(parsed_line)
                    line_sequence += 1
                    parsed_line_indices.add(i)
                    continue

            # 记录未解析的行（在剧集内但未被识别）
            if current_episode and current_scene and line:
                if i not in parsed_line_indices:
                    # 只记录非空的行
                    if len(line) > 0:
                        result["unparsed_lines"].append({
                            "line_number": i + 1,
                            "content": line[:100]  # 只保存前100字符
                        })

        # 验证并添加警告
        ScriptParser._add_validation_warnings(result, text)

        return result

    @staticmethod
    def _add_validation_warnings(result: Dict[str, Any], text: str) -> None:
        """添加验证警告到结果中"""
        warnings = []

        # 检查标题
        if not result.get("title"):
            warnings.append("未识别到剧本标题，请确保使用格式：'《剧本名》'")

        # 检查人物表
        if len(result.get("characters", [])) == 0:
            warnings.append("未识别到人物表，请确保有'人物表：'行，后面跟随角色描述")

        # 检查剧集
        if len(result.get("episodes", [])) == 0:
            warnings.append("未识别到任何剧集，请确保使用格式：'第1集'、'第2集'等")
        else:
            # 检查是否有空剧集
            for ep in result["episodes"]:
                if len(ep.get("scenes", [])) == 0:
                    warnings.append(f"第{ep['episode_number']}集没有识别到场景，请检查场景头格式（如：一、场景名  日  外）")

        # 检查未解析的行
        unparsed_count = len(result.get("unparsed_lines", []))
        if unparsed_count > 0:
            warnings.append(f"有 {unparsed_count} 行内容未能正确解析，可能格式不符合规范")

        result["warnings"] = warnings

    @staticmethod
    def _parse_character_line(line: str) -> Optional[Dict]:
        """解析人物行"""
        # 格式：角色名：描述 或 角色名：年龄，性别，描述
        if "：" in line or ":" in line:
            parts = re.split(r'[:：]', line, 1)
            if len(parts) >= 2:
                name = parts[0].strip()
                desc = parts[1].strip()

                character = {"name": name, "description": desc}

                # 尝试解析年龄和性别
                # 格式：15岁，男，描述
                age_match = re.search(r'(\d+)\s*岁', desc)
                if age_match:
                    character["age"] = age_match.group(1)

                gender_match = re.search(r'(男|女)', desc)
                if gender_match:
                    character["gender"] = gender_match.group(1)

                # 清理描述
                clean_desc = desc
                clean_desc = re.sub(r'\d+\s*岁[，,]?\s*', '', clean_desc)
                clean_desc = re.sub(r'[男女][，,]?\s*', '', clean_desc)
                character["description"] = clean_desc.strip() or desc

                return character

        return None

    @staticmethod
    def _parse_line(line: str, sequence: int) -> Optional[Dict]:
        """解析单行内容"""
        base_line = {
            "sequence": sequence,
            "content": line
        }

        # 视觉镜头 - 标准格式
        visual_match = ScriptParser.VISUAL_SHOT_PATTERN.match(line)
        if visual_match:
            content = visual_match.group(1).strip()
            base_line["line_type"] = "visual"

            # 检查是否有视觉类型标签
            if content.startswith("【") and "】" in content:
                type_end = content.index("】")
                base_line["visual_type"] = content[1:type_end]
                base_line["visual_description"] = content[type_end + 1:].strip()
            else:
                base_line["visual_description"] = content

            return base_line

        # 视觉镜头 - 容错格式 [视觉]:xxx
        visual_alt_match = ScriptParser.VISUAL_SHOT_PATTERN_ALT.match(line)
        if visual_alt_match:
            base_line["line_type"] = "visual"
            base_line["visual_description"] = visual_alt_match.group(1).strip()
            return base_line

        # 对话
        dialogue_match = ScriptParser.DIALOGUE_PATTERN.match(line)
        if dialogue_match:
            character = dialogue_match.group(1).strip()
            parenthetical = dialogue_match.group(2)
            dialogue = dialogue_match.group(3).strip()

            base_line["line_type"] = "dialogue"
            base_line["character"] = character
            base_line["parenthetical"] = parenthetical
            base_line["dialogue"] = dialogue

            return base_line

        # 其他内容作为动作描述
        if line.startswith("（") or line.startswith("(") or line.startswith("【"):
            base_line["line_type"] = "action"
            base_line["visual_description"] = line
        else:
            base_line["line_type"] = "action"
            base_line["visual_description"] = line

        return base_line

    @staticmethod
    def import_script_to_project(project_id: str, script_id: str, text: str) -> Dict:
        """将解析后的��本导入到项目，返回详细结果和警告信息"""
        parsed = ScriptParser.parse_script_text(text)

        # 统计信息
        total_scenes = sum(len(ep.get("scenes", [])) for ep in parsed.get("episodes", []))
        total_lines = sum(len(scene.get("lines", [])) for ep in parsed.get("episodes", []) for scene in ep.get("scenes", []))

        # 更新剧本标题
        if parsed.get("title"):
            ScriptService.update_script(project_id, script_id, title=parsed["title"])

        # 导入人物
        for char_data in parsed.get("characters", []):
            ScriptCharacterService.add_character(project_id, script_id, char_data)

        # 导入集数和场景
        for ep_data in parsed.get("episodes", []):
            episode = ScriptEpisodeService.add_episode(
                project_id, script_id,
                episode_number=ep_data["episode_number"],
                title=ep_data.get("title", "")
            )

            for scene_data in ep_data.get("scenes", []):
                scene = ScriptSceneService.add_scene(
                    project_id, script_id, episode["episode_id"],
                    {
                        "sequence": scene_data["sequence"],
                        "location": scene_data["location"],
                        "time_of_day": scene_data["time_of_day"],
                        "interior_exterior": scene_data["interior_exterior"],
                        "content": ""
                    }
                )

                # 导入镜头行
                for line_data in scene_data.get("lines", []):
                    ScriptLineService.add_line(
                        project_id, script_id, scene["scene_id"],
                        {**line_data, "scene_id": scene["scene_id"]}
                    )

        # 判断是否成功（至少有一些内容被解析）
        has_content = (
            len(parsed.get("episodes", [])) > 0 or
            len(parsed.get("characters", [])) > 0 or
            parsed.get("title")
        )

        return {
            "success": has_content,
            "title": parsed.get("title", ""),
            "characters_count": len(parsed.get("characters", [])),
            "episodes_count": len(parsed.get("episodes", [])),
            "scenes_count": total_scenes,
            "lines_count": total_lines,
            "warnings": parsed.get("warnings", []),
            "unparsed_sample": parsed.get("unparsed_lines", [])[:5]  # 只返回前5个未解析样例
        }
