from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
from app.core.context import get_current_data_root


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class Message(BaseModel):
    """对话消息"""
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str  # "user", "assistant", "system"
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
    thinking: Optional[str] = None  # AI思考过程（可折叠）
    assets_extracted: Optional[Dict[str, List[str]]] = None  # 提取的资产ID


class Conversation:
    """对话管理类"""
    def __init__(self, project_id: str, conversation_id: Optional[str] = None):
        self.project_id = project_id
        self.conversation_id = conversation_id or str(uuid.uuid4())
        self.messages: List[Message] = []
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()

        # 加载或创建对话文件
        self.conversation_dir = _get_projects_dir() / project_id / "conversations"
        self.conversation_dir.mkdir(exist_ok=True)
        self.file_path = self.conversation_dir / f"{self.conversation_id}.json"

        if self.file_path.exists():
            self.load()
        else:
            self.save()

    def add_message(self, role: str, content: str, thinking: Optional[str] = None,
                   assets_extracted: Optional[Dict[str, List[str]]] = None):
        """添加消息"""
        message = Message(
            role=role,
            content=content,
            thinking=thinking,
            assets_extracted=assets_extracted
        )
        self.messages.append(message)
        self.updated_at = datetime.now().isoformat()
        self.save()
        return message

    def save(self):
        """保存对话到文件"""
        import json
        data = {
            "conversation_id": self.conversation_id,
            "project_id": self.project_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "messages": [msg.model_dump() for msg in self.messages]
        }
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def load(self):
        """从文件加载对话"""
        import json
        with open(self.file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.created_at = data["created_at"]
        self.updated_at = data["updated_at"]
        self.messages = [Message(**msg) for msg in data["messages"]]

    def get_context(self, last_n: Optional[int] = None) -> List[Dict]:
        """获取对话上下文"""
        messages = self.messages[-last_n:] if last_n else self.messages
        return [
            {
                "role": msg.role,
                "content": msg.content
            }
            for msg in messages
        ]


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
