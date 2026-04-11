from pydantic import BaseModel
from typing import List, Optional, Dict


class AssetExtractRequest(BaseModel):
    """资产提取请求"""
    project_id: str
    text: str
    conversation_id: Optional[str] = None


class AssetExtractResponse(BaseModel):
    """资产提取响应"""
    characters: List[Dict] = []
    scenes: List[Dict] = []
    props: List[Dict] = []
    episodes: List[Dict] = []
    thinking: Optional[str] = None
