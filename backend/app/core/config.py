from pydantic_settings import BaseSettings
from typing import Optional
from pathlib import Path


class Settings(BaseSettings):
    # API Settings
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8501
    CORS_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000"]

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

    # Alibaba DashScope (Bailian) API Defaults
    DASHSCOPE_IMAGE_API_URL: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    DASHSCOPE_IMAGE_EDIT_MODEL: str = "wan2.6-image"
    DASHSCOPE_VIDEO_API_URL: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

# Ensure directories exist
settings.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
settings.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
