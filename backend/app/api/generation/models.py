"""
Generation API - Pydantic 模型定义
"""

from pydantic import BaseModel, validator, Field
from typing import Optional, List, Dict


class PromptTemplateUpdate(BaseModel):
    image_prompt_template: Optional[str] = None
    video_prompt_template: Optional[str] = None
    video_reverse_prompt_template: Optional[str] = None
    storyboard_generation_prompt_template: Optional[str] = None
    storyboard_image_prompt_template: Optional[str] = None
    storyboard_image_edit_prompt_template: Optional[str] = None
    image_edit_prompt_template: Optional[str] = None
    triple_grid_prompt_template: Optional[str] = None
    vlm_prompt_template: Optional[str] = None  # VLM统一分析模板
    multi_scene_video_prompt: Optional[str] = None  # 多分镜融合视频提示词模板


class ImagePromptRequest(BaseModel):
    asset_type: str  # "character", "scene", "prop", "storyboard"
    description: str
    asset_id: Optional[str] = None  # 资产ID，提供后会自动保存生成的提示词
    # 分镜特有字段（仅当asset_type为storyboard时使用）
    shot_type: str = ""
    action: str = ""
    camera_angle: str = ""
    # 是否使用图生图编辑模板（仅当asset_type为storyboard时有效）
    use_image_edit: bool = False


class ImageGenerateRequest(BaseModel):
    asset_id: str
    asset_type: str
    prompt: str
    negative_prompt: str = ""
    size: Optional[str] = None  # 分辨率，格式如 "1024x1024" 或 "1x1"，为空时使用配置


class VideoPromptRequest(BaseModel):
    storyboard_id: str
    description: str
    dialogue: str = ""
    action: str = ""
    shot_type: str = ""
    camera_angle: str = ""
    characters: list = []
    scene: str = ""
    props: list = []
    duration: int = 6


class VideoReversePromptRequest(BaseModel):
    """反推视频提示词请求（使用VLM）"""
    storyboard_id: str
    image_base64: str  # 分镜主图的base64编码
    description: str
    dialogue: str = ""
    action: str = ""
    shot_type: str = ""
    camera_angle: str = ""
    characters: list = []
    scene: str = ""
    props: list = []
    duration: int = 6


class VideoPromptSubagentRequest(BaseModel):
    """独立子代：单分镜视频提示词生成请求"""
    storyboard_id: str
    description: str = ""
    dialogue: str = ""
    action: str = ""
    shot_type: str = ""
    camera_angle: str = ""
    duration: Optional[int] = None


class VideoGenerateRequest(BaseModel):
    storyboard_id: Optional[str] = None
    episode_id: Optional[str] = None
    image_id: Optional[str] = None  # 单图模式（兼容旧版）
    image_ids: Optional[List[str]] = None  # 多图模式（首尾帧）
    prompt: str
    duration: int = 6
    resolution: str = "1920x1080"
    # 多模态输入（Seedance 2.0）
    video_urls: Optional[List[str]] = None   # 参考视频公网 URL
    audio_urls: Optional[List[str]] = None   # 参考音频公网 URL 或 Base64
    # 2.0 新参数
    use_web_search: bool = False             # 联网搜索增强
    ratio: Optional[str] = None             # 宽高比（含 adaptive）
    generate_audio: Optional[bool] = None   # 是否生成音频（覆盖项目配置）
    reference_media: Optional[List[Dict]] = None  # 参考素材元数据（{type,id?,url,name}列表）

    @validator('image_ids', pre=True, always=True)
    def validate_images(cls, v, values):
        """验证图片参数：image_id/image_ids 或多模态输入（video_urls/audio_urls）至少提供一种"""
        image_id = values.get('image_id')
        if v is None and image_id:
            return [image_id]
        # 多模态路径：有 video_urls 或 audio_urls 时允许无图片
        video_urls = values.get('video_urls')
        audio_urls = values.get('audio_urls')
        if v is None and not image_id and not video_urls and not audio_urls:
            raise ValueError('必须提供 image_id、image_ids 或 video_urls/audio_urls')
        if v and len(v) > 10:
            raise ValueError('最多支持10个分镜')
        return v


class VideoBatchGenerateRequest(BaseModel):
    """批量生成分镜视频请求（后端自动从分镜关联资产收集图片）"""
    episode_id: str


class VideoSubtitleRemovalRequest(BaseModel):
    """视频字幕擦除请求"""
    source_video_url: str
    source_video_id: Optional[str] = None
    storyboard_id: Optional[str] = None
    episode_id: Optional[str] = None
    prompt: str = "去除字幕"


class ImageEditPromptRequest(BaseModel):
    """生成图像编辑提示词请求"""
    parent_asset_id: str  # 父角色ID
    child_asset_id: str   # 子角色ID


class ImageEditRequest(BaseModel):
    """图像编辑请求（基于参考图生成新图）"""
    asset_id: str                    # 目标资产ID
    asset_type: str = "character"    # 资产类型
    prompt: str                      # 编辑提示词
    size: Optional[str] = None       # 图片尺寸，格式如 "1024x1024" 或 "1x1"，为空时使用配置
    reference_image_ids: List[str] = []  # 参考图片ID列表（可选）
    reference_image_urls: List[str] = [] # 参考图片URL列表（可选），直接使用URL而不需要先上传
    template: Optional[str] = None   # 模板ID（可选），如 "character_sheet" 用于生成人设图


class FusionPromptRequest(BaseModel):
    """生成融合图片提示词请求"""
    asset_ids: List[str]  # 源资产ID列表
    asset_types: List[str]  # 源资产类型列表
    user_prompt: str  # 用户输入的融合提示词


class FusionImageRequest(BaseModel):
    """融合图片生成请求"""
    asset_ids: List[str]  # 源资产ID列表
    asset_types: List[str]  # 源资产类型列表
    prompt: str  # 完整的融合提示词
    image_ids: List[str]  # 源图片ID列表
    size: Optional[str] = None  # 图片尺寸
    canvas_element_id: Optional[str] = None  # 画布元素ID（用于关联生成的图片）


class VideoExportRequest(BaseModel):
    episode_id: str
    storyboard_ids: Optional[List[str]] = None  # 可选，指定要导出的分镜 ID 列表


class JianyingExportRequest(BaseModel):
    """剪映导出请求"""
    episode_id: str
    storyboard_ids: Optional[List[str]] = None
    mode: str = "new"  # "new" 或 "existing"
    project_name: Optional[str] = None  # 新项目名（mode=new 时必填）
    existing_project_id: Optional[str] = None  # 现有项目ID（mode=existing 时必填）


class JianyingDownloadRequest(BaseModel):
    """剪映下载导出请求（生成可下载 ZIP 包）"""
    episode_id: str
    project_name: Optional[str] = None  # 可选，默认按日期生成


class ImageSplitTripleRequest(BaseModel):
    """拆解三宫格图片请求"""
    storyboard_id: str  # 要拆解的分镜ID


class VLMAnalyzeRequest(BaseModel):
    """VLM图片分析请求（统一接口）"""
    image_ids: List[str]  # 要分析的图片ID列表
    user_goal: str        # 用户的分析目标（会填充到VLM模板的占位符中）

    # 分镜上下文信息（可选，用于提供额外的文字信息）
    descriptions: List[str] = []      # 每个分镜的描述
    shot_types: List[str] = []        # 镜头类型
    camera_angles: List[str] = []     # 镜头角度
    actions: List[str] = []           # 动作
    dialogues: List[str] = []         # 对话


class StoryboardExportRequest(BaseModel):
    """分镜导出请求"""
    storyboard_ids: List[str]  # 要导出的分镜ID列表
    prompt: str = ""  # 提示词内容


class MultiSceneVideoPromptRequest(BaseModel):
    """多分镜融合视频提示词生成请求"""
    storyboard_ids: List[str]  # 选中的分镜ID列表


# ==================== 全局风格配置模型 ====================

class StyleConfig(BaseModel):
    """风格配置"""
    preset_id: str = "none"      # 预设ID（"none", "pixar_3d", "custom"等）
    custom_suffix: str = ""      # 自定义风格后缀（当preset_id为"custom"时使用）
    enabled: bool = True         # 是否启用
    custom_presets: List[Dict[str, str]] = Field(default_factory=list)  # 多个自定义预设 [{id, name, content}]
    active_custom_id: str = ""   # 当前选中的自定义预设ID


class GlobalStyleConfig(BaseModel):
    """全局风格配置"""
    prompt_language: str = "zh"  # 提示词语言：zh/en/auto
    image_style: StyleConfig = Field(default_factory=StyleConfig)
    video_style: StyleConfig = Field(default_factory=StyleConfig)
    global_resolution: str = "1280x720"  # 全局默认分辨率
    nine_grid_mode: bool = False          # 九宫格模式


class GlobalStyleConfigUpdate(BaseModel):
    """全局风格配置更新（支持部分更新）"""
    prompt_language: Optional[str] = None
    image_style: Optional[StyleConfig] = None
    video_style: Optional[StyleConfig] = None
    global_resolution: Optional[str] = None
    nine_grid_mode: Optional[bool] = None
