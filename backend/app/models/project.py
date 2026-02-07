from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from datetime import datetime
from pathlib import Path
import json
import uuid


class Project:
    """项目管理类，使用文件存储"""

    def __init__(self, project_id: str, name: str, description: str = ""):
        self.project_id = project_id or str(uuid.uuid4())
        self.name = name
        self.description = description
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()

        # 创建项目目录
        from app.core.config import settings
        self.project_dir = settings.PROJECTS_DIR / self.project_id
        self.project_dir.mkdir(parents=True, exist_ok=True)

        # 子目录
        (self.project_dir / "episodes").mkdir(exist_ok=True)
        (self.project_dir / "characters").mkdir(exist_ok=True)
        (self.project_dir / "scenes").mkdir(exist_ok=True)
        (self.project_dir / "props").mkdir(exist_ok=True)
        (self.project_dir / "storyboards").mkdir(exist_ok=True)
        (self.project_dir / "videos").mkdir(exist_ok=True)
        (self.project_dir / "images").mkdir(exist_ok=True)
        # 剧本创作目录
        (self.project_dir / "scripts").mkdir(exist_ok=True)
        # 画布相关目录
        (self.project_dir / "canvas").mkdir(exist_ok=True)
        (self.project_dir / "canvas_elements").mkdir(exist_ok=True)

        # AI配置
        self.ai_config = {
            "llm": {
                "api_url": "",
                "api_key": "",
                "model": ""
            },
            "vlm": {
                "api_url": "",
                "api_key": "",
                "model": ""
            },
            "image": {
                "api_url": "",
                "api_key": "",
                "model": ""
            },
            "video": {
                "api_url": "",
                "api_key": "",
                "model": ""
            }
        }

        # 保存项目元数据
        self.save_metadata()

    def save_metadata(self):
        """保存项目元数据"""
        metadata = {
            "project_id": self.project_id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": datetime.now().isoformat(),
            "ai_config": self.ai_config
        }
        metadata_path = self.project_dir / "metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, project_id: str):
        """加载现有项目"""
        from app.core.config import settings
        project_dir = settings.PROJECTS_DIR / project_id
        metadata_path = project_dir / "metadata.json"

        if not metadata_path.exists():
            raise FileNotFoundError(f"Project {project_id} not found")

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        project = cls.__new__(cls)
        project.project_id = metadata["project_id"]
        project.name = metadata["name"]
        project.description = metadata.get("description", "")
        project.created_at = metadata["created_at"]
        project.updated_at = metadata["updated_at"]
        project.project_dir = project_dir
        project.ai_config = metadata.get("ai_config", {})

        # 确保所有必要的子目录存在（兼容旧项目）
        (project_dir / "episodes").mkdir(exist_ok=True)
        (project_dir / "characters").mkdir(exist_ok=True)
        (project_dir / "scenes").mkdir(exist_ok=True)
        (project_dir / "props").mkdir(exist_ok=True)
        (project_dir / "storyboards").mkdir(exist_ok=True)
        (project_dir / "videos").mkdir(exist_ok=True)
        (project_dir / "images").mkdir(exist_ok=True)
        (project_dir / "scripts").mkdir(exist_ok=True)
        (project_dir / "canvas").mkdir(exist_ok=True)
        (project_dir / "canvas_elements").mkdir(exist_ok=True)

        return project

    def to_dict(self):
        """转换为字典"""
        return {
            "project_id": self.project_id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "ai_config": self.ai_config
        }


class Asset(BaseModel):
    """资产基类"""
    asset_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    tags: List[str] = []
    metadata: Dict = {}
    image_id: Optional[str] = None  # 主图ID
    image_prompt: Optional[str] = None  # AI生成的图片提示词


class Character(Asset):
    """角色资产"""
    gender: Optional[str] = None
    age: Optional[str] = None
    appearance: str = ""
    personality: str = ""
    background: str = ""
    parent_id: Optional[str] = None  # 父角色ID，用于继承


class Scene(Asset):
    """场景资产"""
    time_of_day: Optional[str] = None
    weather: Optional[str] = None
    location: str = ""
    mood: str = ""
    parent_id: Optional[str] = None  # 父场景ID，用于继承


class Prop(Asset):
    """道具资产"""
    category: Optional[str] = None
    material: Optional[str] = None
    era: Optional[str] = None


class Episode(Asset):
    """剧集资产"""
    episode_number: int
    script: str = ""
    duration: Optional[str] = None
    storyboard_ids: List[str] = []  # 分镜ID列表


class Storyboard(Asset):
    """分镜资产"""
    episode_id: str
    sequence: int
    description: str = ""
    character_ids: List[str] = []  # 参演角色
    scene_id: Optional[str] = None  # 场景
    prop_ids: List[str] = []  # 道具
    camera_angle: Optional[str] = None
    shot_type: Optional[str] = None
    dialogue: str = ""
    action: str = ""


class ImageGeneration(BaseModel):
    """图片生成记录"""
    image_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    asset_id: str
    asset_type: str  # "character", "scene", "prop", "storyboard"
    prompt: str
    negative_prompt: str = ""
    model: str = ""
    width: int = 1024
    height: int = 1024
    image_path: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    is_primary: bool = False


class VideoGeneration(BaseModel):
    """视频生成记录"""
    video_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    storyboard_id: str
    episode_id: str
    prompt: str
    model: str = ""
    duration: int = 5
    video_path: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    is_primary: bool = False  # 是否为主视频


# ==================== 剧本创作相关模型 ====================

class Script(BaseModel):
    """剧本 - 独立的剧本资产"""
    script_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "未命名剧本"
    description: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class ScriptCharacter(BaseModel):
    """剧本人物 - 独立于资产角色"""
    character_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    script_id: str
    name: str
    age: Optional[str] = None
    gender: Optional[str] = None
    description: str = ""
    notes: str = ""  # 额外备注
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class ScriptEpisode(BaseModel):
    """剧本剧集 - 关联到剧本的集数"""
    episode_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    script_id: str
    episode_number: int
    title: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class ScriptScene(BaseModel):
    """剧本场景"""
    scene_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    episode_id: str
    sequence: int  # 场景序号（一二三...对应的数字）
    location: str  # 场景名，如"金陵秦淮河"
    time_of_day: str  # 日/夜
    interior_exterior: str  # 内/外
    content: str  # 完整场景原始文本
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class ShotLine(BaseModel):
    """镜头行 - 场景内的可编辑行"""
    line_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    scene_id: str
    line_type: str  # "visual"(视觉镜头), "dialogue"(对话), "action"(动作描述), "scene_header"(场景头)
    sequence: int  # 在场景中的序号
    content: str  # 完整内容

    # 对话专用字段
    character: Optional[str] = None  # 角色名
    parenthetical: Optional[str] = None  # 括号内的语气/动作
    dialogue: Optional[str] = None  # 台词内容

    # 视觉镜头专用字段
    visual_type: Optional[str] = None  # 视觉类型（如"视觉开场"）
    visual_description: Optional[str] = None  # 视觉描述

    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())


# ==================== 画布相关模型 ====================

class Canvas(BaseModel):
    """画布 - 支持多画布功能"""
    canvas_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str
    name: str = "默认画布"
    description: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    # 视图配置
    zoom: float = 1.0
    pan_x: float = 0.0
    pan_y: float = 0.0
    # 元素位置信息列表
    # 每个元素: {id: str, type: str, x: float, y: float, width: float, height: float}
    elements: List[Dict] = []


class CanvasElement(Asset):
    """画布元素 - 通过多选融合生成的图片"""
    source_asset_ids: List[str] = []  # 源资产ID列表
    source_types: List[str] = []  # 源资产类型列表 ["character", "scene", ...]
    fusion_prompt: str = ""  # 融合提示词
