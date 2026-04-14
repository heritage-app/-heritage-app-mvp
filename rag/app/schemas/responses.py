"""
Pydantic response schemas for API endpoints.
Humanized responses for better user experience.
"""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    """Response schema for /upload endpoint with humanized messages."""
    
    status: str = Field(..., description="Upload status (e.g., 'success', 'processing')")
    file_name: str = Field(..., description="Name of the uploaded file")
    file_size: str | None = Field(None, description="Human-readable file size (e.g., '2.5 MB')")
    message: str = Field(..., description="Friendly status message for the user")
    file_url: str | None = Field(None, description="URL to access the uploaded file")
    next_step: str | None = Field(None, description="Suggested next action (e.g., 'You can now ask questions about this document')")


class AskResponse(BaseModel):
    """Response schema for /ask endpoint (non-streaming) with humanized format."""
    
    conversation_id: str = Field(..., description="Your conversation ID - save this to continue chatting")
    response: str = Field(..., description="The assistant's response to your question")
    query: str = Field(..., description="Your original question")
    timestamp: str = Field(..., description="When this response was generated (human-readable format)")


class MessageResponse(BaseModel):
    """Response schema for a message with humanized timestamps."""
    
    id: str = Field(..., description="Unique message identifier")
    conversation_id: str = Field(..., description="Conversation this message belongs to")
    role: str = Field(..., description="Who sent this: 'you' (user) or 'assistant'")
    content: str = Field(..., description="The message content")
    sent_at: str = Field(..., description="When this message was sent (e.g., '2 minutes ago', 'Today at 3:45 PM')")
    created_at: datetime = Field(..., description="Raw timestamp for sorting")


class ConversationResponse(BaseModel):
    """Response schema for conversation messages with humanized format."""
    
    conversation_id: str = Field(..., description="Your conversation ID")
    title: str | None = Field(None, description="What this conversation is about")
    messages: list[MessageResponse] = Field(..., description="All messages in this conversation")
    total: str = Field(..., description="Total number of messages (e.g., '15 messages')")
    last_activity: str | None = Field(None, description="Last activity time (e.g., 'Active 5 minutes ago')")


class HealthResponse(BaseModel):
    """Response schema for /health endpoint with friendly status."""
    
    status: str = Field(..., description="Service status (e.g., 'All systems operational')")
    message: str = Field(default="Service is running smoothly", description="Friendly status message")
    timestamp: str = Field(..., description="Current time (human-readable format)")
    uptime: str | None = Field(None, description="How long the service has been running")


class APIInfoResponse(BaseModel):
    """Response schema for root endpoint with helpful information."""
    
    message: str = Field(..., description="Welcome message for the API")
    description: str | None = Field(None, description="What this API does")
    endpoints: dict[str, str] = Field(..., description="Available endpoints you can use")
    version: str | None = Field(None, description="API version")


class ConversationListItem(BaseModel):
    """Response schema for a conversation list item with humanized format."""
    
    conversation_id: str = Field(..., description="Your conversation ID")
    title: str | None = Field(None, description="What this conversation is about")
    last_message: str | None = Field(None, description="Preview of the last message")
    last_activity: str = Field(..., description="When you last chatted (e.g., 'Just now', '2 hours ago', 'Yesterday')")
    message_count: str | None = Field(None, description="Number of messages (e.g., '12 messages')")


class ConversationsListResponse(BaseModel):
    """Response schema for conversations list with humanized format."""
    
    conversations: list[ConversationListItem] = Field(..., description="Your conversations")
    total: str = Field(..., description="Total number of conversations (e.g., '5 conversations')")
    summary: str | None = Field(None, description="Summary message (e.g., 'You have 5 active conversations')")


class DocumentListItem(BaseModel):
    """Response schema for a single document list item."""
    id: str = Field(..., description="The document ID (MongoDB)")
    original_filename: str = Field(..., description="The name of the originally uploaded file")
    public_url: str = Field(..., description="The public URL where the file can be downloaded")
    status: str = Field(..., description="Processing status (e.g., 'indexed')")
    uploaded_at: str = Field(..., description="When the file was uploaded (human-readable)")

class DocumentListResponse(BaseModel):
    """Response schema for a list of all documents."""
    documents: list[DocumentListItem] = Field(..., description="List of documents")
    total: int = Field(..., description="Total number of documents")

class UserListItem(BaseModel):
    """Response schema for a single user in the management list."""
    id: str = Field(..., description="The user's unique ID (MongoDB)")
    email: str = Field(..., description="The user's email address")
    role: str = Field(..., description="The user's current role (e.g., 'admin', 'moderator', 'user')")
    display_name: str | None = Field(None, description="User's display name")
    first_name: str | None = Field(None, description="User's first name")
    last_name: str | None = Field(None, description="User's last name")
    dob: str | None = Field(None, description="User's date of birth")
    created_at: str = Field(..., description="When the user joined (human-readable)")

class UserListResponse(BaseModel):
    """Response schema for a list of users."""
    users: list[UserListItem] = Field(..., description="List of registered users")
    total: int = Field(..., description="Total number of registered users")


class SystemStatsResponse(BaseModel):
    """Response schema for global system statistics in the admin dashboard."""
    total_documents: int = Field(..., description="Total number of indexed documents")
    registered_users: int = Field(..., description="Total number of registered users (from profiles)")
    user_conversations: int = Field(..., description="Total number of conversations by registered users")
    guest_conversations: int = Field(..., description="Total number of guest conversations")
    total_conversations: int = Field(..., description="Grand total of all conversations")
    status: str = Field(..., description="System health status (e.g., 'operational')")
    timestamp: str = Field(..., description="UTC timestamp of the stats report")


class RefinementPreviewResponse(BaseModel):
    """Response schema for the /refine/preview endpoint."""
    raw_text: str = Field(..., description="Extracted raw text (truncated for preview)")
    refined_records: list[dict] = Field(..., description="List of 16-field verse records")
    jsonl_preview: str = Field(..., description="Preview of the generated JSONL archival format")
    stats: dict = Field(..., description="Statistics about the extraction (counts, chapters, etc.)")


class RefineCommitRequest(BaseModel):
    """Request schema for the /refine/commit endpoint."""
    staged_records: list[dict] = Field(..., description="Validated records to be indexed")
    original_filename: str = Field(..., description="The name of the original file")

