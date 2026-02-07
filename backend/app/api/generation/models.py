"""
Generation API - Pydantic 模型定义
"""

from pydantic import BaseModel, validator
from typing import Optional, List


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


class ImagePromptRequest(BaseModel):
    asset_type: str  # "character", "scene", "prop", "storyboard"
    description: str
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


class VideoGenerateRequest(BaseModel):
    storyboard_id: str
    episode_id: str
    image_id: Optional[str] = None  # 单图模式（兼容旧版）
    image_ids: Optional[List[str]] = None  # 多图模式（首尾帧）
    prompt: str
    duration: int = 6
    resolution: str = "1920x1080"

    @validator('image_ids', pre=True, always=True)
    def validate_images(cls, v, values):
        """验证图片参数：必须提供 image_id 或 image_ids 之一"""
        image_id = values.get('image_id')
        if v is None and image_id:
            # 自动将 image_id 转换为 image_ids
            return [image_id]
        if v is None and not image_id:
            raise ValueError('必须提供 image_id 或 image_ids')
        if v and len(v) > 2:
            raise ValueError('最多支持2张图片（首尾帧模式）')
        return v


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
