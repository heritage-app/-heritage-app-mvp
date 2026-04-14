"""
Pydantic request schemas for API endpoints.
"""

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    """Request schema for chat endpoints."""
    
    query: str = Field(..., description="User question/query", min_length=1)
    model: str | None = Field(None, description="Optional model identifier (e.g. 'gemini-2.0-flash')")
    mode: str | None = Field("auto", description="RAG mode: 'bible', 'general', or 'auto'")


class ProfileUpdate(BaseModel):
    """Request schema for updating user profile."""
    
    first_name: str | None = Field(None, description="User's first name")
    last_name: str | None = Field(None, description="User's last name")
    dob: str | None = Field(None, description="User's date of birth (YYYY-MM-DD)")

