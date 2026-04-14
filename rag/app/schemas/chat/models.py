from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field

class ChatSessionBase(BaseModel):
    title: Optional[str] = "New Chat"
    status: str = "active"

class ChatSessionCreate(ChatSessionBase):
    pass

class ChatSession(ChatSessionBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class ChatMessageBase(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ChatMessageCreate(ChatMessageBase):
    session_id: UUID

class ChatMessage(ChatMessageBase):
    id: UUID
    session_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}
