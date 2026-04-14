from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import UUID
from pydantic import BaseModel, Field

class DocumentBase(BaseModel):
    filename: str
    storage_bucket: str
    storage_path: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    source_metadata: Dict[str, Any] = Field(default_factory=dict)
    version: str = "1.0.0"
    file_hash: Optional[str] = None

class DocumentCreate(DocumentBase):
    pass

class Document(DocumentBase):
    id: UUID
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class IngestionJobBase(BaseModel):
    document_id: UUID

class IngestionJobCreate(IngestionJobBase):
    pass

class IngestionJob(IngestionJobBase):
    id: UUID
    status: str = Field(..., pattern="^(queued|processing|indexed|failed)$")
    error_message: Optional[str] = None
    attempt_count: int = 0
    heartbeat_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}

class UploadResponse(BaseModel):
    document_id: UUID
    job_id: UUID
    status: str
    filename: str
