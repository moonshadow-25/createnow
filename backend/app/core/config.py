from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional
from pathlib import Path

# 项目根目录（config.py 在 backend/app/core/，向上四层到根目录）
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        case_sensitive=True,
        extra="ignore",
    )
    # API Settings
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8501
    CORS_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8501", "https://localhost:8501", "https://localhost:8510"]

    # Storage Paths
    BASE_DIR: Path = Path(__file__).parent.parent.parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    PROJECTS_DIR: Path = DATA_DIR / "projects"
    CONFIG_DIR: Path = DATA_DIR / "config"

    # AI API Defaults (can be overridden per project)
    DEFAULT_LLM_API_URL: str = "https://api.openai.com/v1"
    DEFAULT_LLM_API_KEY: str = ""
    DEFAULT_LLM_MODEL: str = "gpt-4"

    DEFAULT_IMAGE_API_URL: str = "https://api.openai.com/v1"
    DEFAULT_IMAGE_API_KEY: str = ""
    DEFAULT_IMAGE_MODEL: str = "dall-e-3"

    DEFAULT_VIDEO_API_URL: str = "https://api.openai.com/v1"
    DEFAULT_VIDEO_API_KEY: str = ""
    DEFAULT_VIDEO_MODEL: str = "sora"

    # VLM (Vision Language Model - 图片理解/反推提示词)
    DEFAULT_VLM_API_URL: str = "https://api.openai.com/v1"
    DEFAULT_VLM_API_KEY: str = ""
    DEFAULT_VLM_MODEL: str = "gpt-4o"

    # TTS (Text-to-Speech - 文本转语音)
    DEFAULT_TTS_API_URL: str = "https://api.openai.com/v1"
    DEFAULT_TTS_API_KEY: str = ""
    DEFAULT_TTS_MODEL: str = "tts-1"
    DEFAULT_TTS_VOICE: str = "alloy"

    # Alibaba DashScope (Bailian) API Defaults
    DASHSCOPE_IMAGE_API_URL: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    DASHSCOPE_IMAGE_EDIT_MODEL: str = "wan2.6-image"
    DASHSCOPE_VIDEO_API_URL: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
    DASHSCOPE_TTS_API_URL: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/speech-synthesis"

    # CreateNow 官方接口
    CREATENOW_BASE_URL: str = "https://myapi.firstarpc.com/v1"
    # 安全要求：严禁在代码中硬编码真实密钥，必须从环境变量注入
    CREATENOW_SECRET_KEY: str = ""
    CREATENOW_OFFICIAL_HOST: str = "myapi.firstarpc.com"
    CREATENOW_SUBTITLE_SUBMIT_PATH: str = "/api/v1/ark-tools/ark-erase-video-subtitle-pro"
    CREATENOW_SUBTITLE_POLL_PATH: str = "/api/v1/ark-tasks/{task_id}"
    CREATENOW_SUBTITLE_MODEL_ID: str = "zm1"

    # 部署模式：selfhosted（默认，现有行为） | saas（Web 公网版）
    DEPLOY_MODE: str = "selfhosted"

    # Redis（SaaS 模式使用）
    REDIS_URL: str = "redis://localhost:6379/0"

    # SaaS 用户数据目录（DEPLOY_MODE=saas 时生效）
    # 每个用户数据存放在 DATA_DIR/users/{user_id}/
    @property
    def USERS_DIR(self):
        return self.DATA_DIR / "users"


settings = Settings()

# Ensure directories exist
settings.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
settings.CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# Seedance 2.0 模型 ID 常量
SEEDANCE_2_0_MODEL = "doubao-seedance-2-0-260128"
SEEDANCE_2_0_FAST_MODEL = "doubao-seedance-2-0-fast-260128"
