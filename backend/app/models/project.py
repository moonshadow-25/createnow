from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Union, Any
from datetime import datetime
from pathlib import Path
import copy
import json
import uuid


_DEFAULT_GLOBAL_STYLE_CONFIG = {
    "prompt_language": "zh",
    "image_style": {
        "preset_id": "cinematic_realistic",
        "custom_suffix": "",
        "enabled": True,
        "custom_presets": [],
        "active_custom_id": "",
    },
    "video_style": {
        "preset_id": "cinematic_realistic_video",
        "custom_suffix": "",
        "enabled": True,
        "custom_presets": [],
        "active_custom_id": "",
    },
    "global_resolution": "1280x720",
    "nine_grid_mode": False,
}


def build_default_global_style_config() -> Dict[str, Any]:
    return copy.deepcopy(_DEFAULT_GLOBAL_STYLE_CONFIG)


def normalize_global_style_config(raw: Any) -> Dict[str, Any]:
    default_cfg = build_default_global_style_config()
    if not isinstance(raw, dict):
        return default_cfg

    normalized = copy.deepcopy(default_cfg)
    normalized.update(raw)

    for key in ["image_style", "video_style"]:
        base = copy.deepcopy(default_cfg[key])
        incoming = raw.get(key, {})
        if isinstance(incoming, dict):
            base.update(incoming)
        if not isinstance(base.get("custom_presets"), list):
            base["custom_presets"] = []
        if not isinstance(base.get("active_custom_id"), str):
            base["active_custom_id"] = ""
        normalized[key] = base

    if not isinstance(normalized.get("prompt_language"), str) or not normalized["prompt_language"].strip():
        normalized["prompt_language"] = "zh"
    if not isinstance(normalized.get("global_resolution"), str) or not normalized["global_resolution"].strip():
        normalized["global_resolution"] = "1280x720"
    normalized["nine_grid_mode"] = bool(normalized.get("nine_grid_mode", False))

    return normalized


def ensure_global_style_config(ai_config: Optional[Dict[str, Any]]) -> tuple[Dict[str, Any], bool]:
    cfg = copy.deepcopy(ai_config or {})
    existing = cfg.get("global_style_config")
    normalized = normalize_global_style_config(existing)
    changed = existing != normalized
    cfg["global_style_config"] = normalized
    return cfg, changed


class Project:
    """项目管理类，使用文件存储"""

    def __init__(self, project_id: str, name: str, description: str = ""):
        self.project_id = project_id or str(uuid.uuid4())
        self.name = name
        self.description = description
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()

        # 创建项目目录
        from app.core.context import get_current_data_root
        from app.core.config import settings
        data_root = get_current_data_root()
        projects_dir = (data_root / "projects") if data_root else settings.PROJECTS_DIR
        self.project_dir = projects_dir / self.project_id
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

        # 项目进度配置
        self.total_episodes: int = 0
        self.minutes_per_episode: float = 0.0
        self.compute_budget_per_minute: float = 0.0
        self.project_duration_days: int = 0

        # 项目总预算
        self.budget_total: Optional[float] = None   # None = 无限制

        # 项目级 AI 指令（类 CLAUDE.md），注入 system prompt
        self.ai_instructions: str = ""

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
            },
            "global_style_config": build_default_global_style_config(),
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
            "ai_config": self.ai_config,
            "ai_instructions": self.ai_instructions,
            "total_episodes": self.total_episodes,
            "minutes_per_episode": self.minutes_per_episode,
            "compute_budget_per_minute": self.compute_budget_per_minute,
            "project_duration_days": self.project_duration_days,
            "budget_total": self.budget_total,
        }
        metadata_path = self.project_dir / "metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, project_id: str):
        """加载现有项目"""
        from app.core.context import get_current_data_root
        from app.core.config import settings
        data_root = get_current_data_root()
        projects_dir = (data_root / "projects") if data_root else settings.PROJECTS_DIR
        project_dir = projects_dir / project_id
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
        project.ai_config, ai_changed = ensure_global_style_config(project.ai_config)
        project.ai_instructions = metadata.get("ai_instructions", "")
        project.total_episodes = metadata.get("total_episodes", 0)
        project.minutes_per_episode = metadata.get("minutes_per_episode", 0.0)
        project.compute_budget_per_minute = metadata.get("compute_budget_per_minute", 0.0)
        project.project_duration_days = metadata.get("project_duration_days", 0)
        project.budget_total = metadata.get("budget_total", None)

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

        if ai_changed:
            project.save_metadata()

        return project

    def to_dict(self):
        """转换为字典"""
        return {
            "project_id": self.project_id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "ai_config": self.ai_config,
            "ai_instructions": self.ai_instructions,
            "total_episodes": self.total_episodes,
            "minutes_per_episode": self.minutes_per_episode,
            "compute_budget_per_minute": self.compute_budget_per_minute,
            "project_duration_days": self.project_duration_days,
            "budget_total": self.budget_total,
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
    voice_prompt: Optional[str] = None   # 音色描述（提示词）
    voice_id: Optional[str] = None       # TTS 音色名称/ID（如 "zhichu"）
    voice_audio_id: Optional[str] = None  # 主音色样本 AudioGeneration.audio_id


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
    scene_id: Optional[str] = None  # 场景（旧字段，保留兼容）
    scene_ids: List[str] = []  # 多场景支持
    prop_ids: List[str] = []  # 道具
    camera_angle: Optional[str] = None
    shot_type: Optional[str] = None
    dialogue: str = ""
    action: str = ""
    storyboard_mode: str = "regular"  # "regular" | "nine_grid"
    video_prompt: Optional[Union[str, List[str]]] = None
    duration: Optional[int] = None
    transition_frame_image_id: Optional[str] = None
    transition_frame_source_storyboard_id: Optional[str] = None
    transition_frame_source_video_id: Optional[str] = None
    transition_frame_updated_at: Optional[str] = None


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
    volcengine_asset_id: Optional[str] = None      # e.g. "asset-20260318071009-xxxxx"
    volcengine_asset_status: Optional[str] = None  # "Processing" | "Active" | "Failed"


class AudioGeneration(BaseModel):
    """音频生成记录"""
    audio_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str  # 所属项目
    storyboard_id: Optional[str] = None  # 关联的分镜（可选）
    episode_id: Optional[str] = None  # 关联的剧集（可选）
    character_id: Optional[str] = None  # 关联的角色（角色音色样本专用）
    text: str  # 转换的文本内容
    voice: Optional[str] = None  # 音色（OpenAI/阿里百炼）
    speaker_id: Optional[str] = None  # Speaker ID（本地API）
    model: str = ""  # 使用的模型
    audio_path: Optional[str] = None  # 音频URL（如果API返回URL）
    local_path: Optional[str] = None  # 本地文件路径（相对于audios/files/目录）
    duration: Optional[float] = None  # 音频时长（秒）
    format: str = "mp3"  # 音频格式
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    is_primary: bool = False  # 是否为主音频


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
    # 幕/场可选信息（来自时间码格式剧本）
    time_start: Optional[str] = None   # 开始时间，如 "00:00"
    time_end: Optional[str] = None     # 结束时间，如 "01:00"
    act_title: Optional[str] = None    # 幕标题，如 "第一幕：本钱"
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
    """画布 - 支持多画布功能与工作流编排"""
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
    # 元素位置信息列表（旧画布布局，兼容保留）
    # 每个元素: {id: str, type: str, x: float, y: float, width: float, height: float}
    elements: List[Dict[str, Any]] = Field(default_factory=list)
    # 工作流 schema 版本（1=旧画布；2=工作流增强）
    schema_version: int = 2
    # 工作流节点
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    # 工作流连线
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    # 画布级变量
    variables: Dict[str, Any] = Field(default_factory=dict)


class CanvasElement(Asset):
    """画布元素 - 通过多选融合生成的图片"""
    source_asset_ids: List[str] = []  # 源资产ID列表
    source_types: List[str] = []  # 源资产类型列表 ["character", "scene", ...]
    fusion_prompt: str = ""  # 融合提示词
