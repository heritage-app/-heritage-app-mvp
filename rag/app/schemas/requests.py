"""
Pydantic request schemas for API endpoints.
"""

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    """Request schema for chat endpoints."""
    
    query: str = Field(..., description="User question/query", min_length=1)


class UploadRequest(BaseModel):
    """Request schema for /upload endpoint metadata."""
    
    metadata: dict | None = Field(None, description="Optional metadata dictionary")

