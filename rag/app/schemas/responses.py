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

