"""
API routes for the RAG system.
"""

import uuid
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Form
from fastapi.responses import StreamingResponse

from app.rag.service import ask
from app.storage.supabase import upload_document, get_messages, list_conversations, get_conversation_title, conversation_exists, file_exists_in_storage, get_supabase_client, save_message
from app.schemas.requests import AskRequest
from app.rag.indexer import index_document_from_storage, is_document_indexed
from app.rag.vector_store import collection_exists
from app.core.config import settings
from app.rag.constants import DEFAULT_TOP_K
from app.schemas.responses import (
    UploadResponse,
    AskResponse,
    MessageResponse,
    ConversationResponse,
    ConversationsListResponse,
    ConversationListItem,
    HealthResponse,
    APIInfoResponse
)


router = APIRouter(prefix="/api/v1", tags=["rag"])


def humanize_timestamp(timestamp_str: str | datetime | None) -> str:
    """
    Convert a timestamp string or datetime object to a human-readable format.
    
    Args:
        timestamp_str: ISO format timestamp string, datetime object, or None
        
    Returns:
        Human-readable time string (e.g., "Just now", "2 hours ago", "Yesterday")
    """
    if not timestamp_str:
        return "Unknown"
    
    try:
        # Parse the timestamp
        if isinstance(timestamp_str, datetime):
            timestamp = timestamp_str
        elif isinstance(timestamp_str, str):
            if timestamp_str.endswith("Z"):
                timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
            else:
                timestamp = datetime.fromisoformat(timestamp_str)
        else:
            return "Unknown"
        
        # Ensure timezone-aware
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        
        now = datetime.now(timezone.utc)
        diff = now - timestamp
        
        # Calculate time differences
        if diff < timedelta(seconds=60):
            return "Just now"
        elif diff < timedelta(minutes=60):
            minutes = int(diff.total_seconds() / 60)
            return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
        elif diff < timedelta(hours=24):
            hours = int(diff.total_seconds() / 3600)
            return f"{hours} hour{'s' if hours != 1 else ''} ago"
        elif diff < timedelta(days=7):
            days = int(diff.total_seconds() / 86400)
            if days == 1:
                return "Yesterday"
            return f"{days} days ago"
        elif diff < timedelta(days=30):
            weeks = int(diff.total_seconds() / 604800)
            return f"{weeks} week{'s' if weeks != 1 else ''} ago"
        else:
            # Return formatted date for older messages
            return timestamp.strftime("%B %d, %Y")
    except Exception:
        return "Unknown"


@router.post("/upload", response_model=UploadResponse)
async def upload_document_endpoint(
    file: UploadFile = File(..., description="Document file to upload"),
    metadata: str | None = Form(None, description="Optional JSON string metadata")
):
    """
    Upload a document to Supabase Storage and index it as a new version.
    Every upload is assigned a unique timestamp to support multi-version archiving.
    """
    try:
        # 1. Basic validation
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        
        # 2. Generate a unique file path using a timestamp
        original_filename = file.filename
        file_ext = Path(original_filename).suffix
        file_base = Path(original_filename).stem
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        unique_file_path = f"{file_base}_{timestamp}{file_ext}"
        
        # 3. Get file size for response
        file_size_str = None
        try:
            content = await file.read()
            file_size = len(content)
            if file_size > 0:
                size_mb = file_size / (1024 * 1024)
                if size_mb < 1:
                    file_size_str = f"{file_size / 1024:.2f} KB"
                else:
                    file_size_str = f"{size_mb:.2f} MB"
            await file.seek(0)
        except Exception:
            file_size_str = "Unknown"
        
        # 4. Parse custom metadata from frontend
        doc_metadata: dict = {}
        if metadata:
            try:
                doc_metadata = json.loads(metadata)
            except json.JSONDecodeError:
                pass
        
        # 5. Add standard metadata
        # We store both the unique path and the original filename for searchability
        doc_metadata["file_path"] = unique_file_path
        doc_metadata["filename"] = original_filename
        doc_metadata["uploaded_at"] = datetime.now(timezone.utc).isoformat()
        
        # 6. Upload to Supabase Storage (now using the unique path)
        public_url = await upload_document(file, unique_file_path, overwrite=False)
        
        # 7. Index the document version after upload
        await index_document_from_storage(unique_file_path, doc_metadata)
        
        category_msg = f" as category '{doc_metadata.get('category', 'general')}'" if 'category' in doc_metadata else ""
        
        return UploadResponse(
            status="success",
            file_name=original_filename,
            file_size=file_size_str,
            message=f"✅ Document version '{unique_file_path}' uploaded and indexed successfully{category_msg}!",
            file_url=public_url,
            next_step="This version is now added to your heritage archive. You can ask questions about it."
        )
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Cumulative upload failed: {str(e)}")


@router.post("/chat/new")
async def new_chat_endpoint(
    request: AskRequest,
    top_k: int = Query(DEFAULT_TOP_K, description="Number of context chunks to retrieve", ge=1, le=20),
    stream: bool = Query(True, description="Whether to stream the response")
):
    """
    Start a new chat conversation.
    Creates a new conversation and returns the conversation_id in the response.
    
    Args:
        request: AskRequest containing query
        top_k: Number of context chunks to retrieve (default: 5)
        stream: Whether to stream the response (default: True)
        
    Returns:
        StreamingResponse (with X-Conversation-Id header) or AskResponse (with conversation_id in body)
        
    Raises:
        HTTPException 400: If query is empty
        HTTPException 503: If vector store is not initialized
    """
    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")
    
    # Check if collection exists
    if not collection_exists():
        raise HTTPException(
            status_code=503,
            detail="Vector store not initialized. Please upload documents first."
        )
    
    # New chat - conversation_id will be None, save_message will generate a new one
    conversation_id = None
    
    if stream:
        # For streaming: save user message first to get conversation_id
        # Then return it in response headers
        saved_message = await save_message(conversation_id, "user", request.query)
        conversation_id = saved_message.get("conversation_id")
        
        # Return streaming response with conversation_id in headers
        return StreamingResponse(
            ask(request.query, conversation_id, top_k=top_k, stream=True, skip_user_message=True),
            media_type="text/plain",
            headers={"X-Conversation-Id": conversation_id}
        )
    else:
        # For non-streaming: save user message first to get conversation_id
        saved_message = await save_message(conversation_id, "user", request.query)
        conversation_id = saved_message.get("conversation_id")
        
        # Call ask with skip_user_message=True since we already saved it
        response_chunks = []
        async for chunk in ask(request.query, conversation_id, top_k=top_k, stream=False, skip_user_message=True):
            response_chunks.append(chunk)
        
        return AskResponse(
            conversation_id=conversation_id,
            response="".join(response_chunks),
            query=request.query,
            timestamp=datetime.now(timezone.utc).isoformat()
        )


@router.post("/chat/{conversation_id}")
async def continue_chat_endpoint(
    conversation_id: str,
    request: AskRequest,
    top_k: int = Query(DEFAULT_TOP_K, description="Number of context chunks to retrieve", ge=1, le=20),
    stream: bool = Query(True, description="Whether to stream the response")
):
    """
    Continue an existing chat conversation.
    Requires a valid conversation_id that exists in the database.
    
    Args:
        conversation_id: Existing conversation ID (from path)
        request: AskRequest containing query
        top_k: Number of context chunks to retrieve (default: 5)
        stream: Whether to stream the response (default: True)
        
    Returns:
        StreamingResponse (with X-Conversation-Id header) or AskResponse (with conversation_id in body)
        
    Raises:
        HTTPException 404: If conversation_id does not exist
        HTTPException 400: If query is empty
        HTTPException 503: If vector store is not initialized
    """
    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")
    
    # Validate that conversation exists
    if not await conversation_exists(conversation_id):
        raise HTTPException(
            status_code=404,
            detail=f"Conversation with ID '{conversation_id}' not found. Use /chat/new to start a new conversation."
        )
    
    # Check if collection exists
    if not collection_exists():
        raise HTTPException(
            status_code=503,
            detail="Vector store not initialized. Please upload documents first."
        )
    
    if stream:
        # For streaming: save user message first
        # Then return it in response headers
        saved_message = await save_message(conversation_id, "user", request.query)
        conversation_id = saved_message.get("conversation_id")
        
        # Return streaming response with conversation_id in headers
        return StreamingResponse(
            ask(request.query, conversation_id, top_k=top_k, stream=True, skip_user_message=True),
            media_type="text/plain",
            headers={"X-Conversation-Id": conversation_id}
        )
    else:
        # For non-streaming: save user message first
        saved_message = await save_message(conversation_id, "user", request.query)
        conversation_id = saved_message.get("conversation_id")
        
        # Call ask with skip_user_message=True since we already saved it
        response_chunks = []
        async for chunk in ask(request.query, conversation_id, top_k=top_k, stream=False, skip_user_message=True):
            response_chunks.append(chunk)
        
        return AskResponse(
            conversation_id=conversation_id,
            response="".join(response_chunks),
            query=request.query,
            timestamp=datetime.now(timezone.utc).isoformat()
        )


@router.get("/conversations/{conversation_id}/messages", response_model=ConversationResponse)
async def get_conversation_messages(
    conversation_id: str,
    limit: int | None = Query(None, description="Maximum number of messages to retrieve", ge=1, le=100)
):
    """
    Get messages for a conversation.
    
    Args:
        conversation_id: Unique conversation identifier
        limit: Maximum number of messages to retrieve
        
    Returns:
        ConversationResponse: Conversation messages with title
    """
    messages = await get_messages(conversation_id, limit=limit)
    
    # Get conversation title
    title = await get_conversation_title(conversation_id)
    
    message_responses = []
    for msg in messages:
        # Parse created_at timestamp
        created_at_str = msg.get("created_at")
        if created_at_str:
            # Handle ISO format with or without timezone
            if isinstance(created_at_str, str):
                try:
                    if created_at_str.endswith("Z"):
                        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                    else:
                        created_at = datetime.fromisoformat(created_at_str)
                except ValueError:
                    created_at = datetime.now(timezone.utc)
            else:
                created_at = datetime.now(timezone.utc)
        else:
            created_at = datetime.now(timezone.utc)
        
        # Humanize timestamp for sent_at field
        sent_at_str = humanize_timestamp(created_at)
        
        message_responses.append(
            MessageResponse(
                id=str(msg.get("id", "")),
                conversation_id=msg.get("conversation_id", ""),
                role=msg.get("role", ""),
                content=msg.get("content", ""),
                sent_at=sent_at_str,
                metadata=msg.get("metadata", {}),
                created_at=created_at
            )
        )
    
    total_count = len(message_responses)
    total_str = f"{total_count} message{'s' if total_count != 1 else ''}"
    
    # Get last activity time from the most recent message
    last_activity = None
    if message_responses:
        last_message = message_responses[-1]
        last_activity = last_message.sent_at
    
    return ConversationResponse(
        conversation_id=conversation_id,
        title=title,
        messages=message_responses,
        total=total_str,
        last_activity=last_activity
    )


@router.get("/conversations", response_model=ConversationsListResponse)
async def list_conversations_endpoint(
    limit: int = Query(50, description="Maximum number of conversations to retrieve", ge=1, le=100)
):
    """
    List all chat conversations.
    
    Args:
        limit: Maximum number of conversations to retrieve
        
    Returns:
        ConversationsListResponse: List of conversations with their latest message timestamps
    """
    conversations = await list_conversations(limit=limit)
    
    # Fetch additional data for each conversation (message count and last message)
    conversation_items = []
    for conv in conversations:
        conv_id = conv.get("conversation_id", "")
        
        # Get messages to get count and last message in one query
        messages = await get_messages(conv_id)
        message_count = len(messages)
        
        last_message = None
        if messages:
            last_msg = messages[-1]
            content = last_msg.get("content", "")
            # Truncate if too long
            if len(content) > 100:
                last_message = content[:100] + "..."
            else:
                last_message = content
        
        message_count_str = f"{message_count} message{'s' if message_count != 1 else ''}" if message_count > 0 else None
        
        conversation_items.append(
            ConversationListItem(
                conversation_id=conv_id,
                title=conv.get("title"),
                last_message=last_message,
                last_activity=humanize_timestamp(conv.get("last_message_at")),
                message_count=message_count_str
            )
        )
    
    total_count = len(conversation_items)
    total_str = f"{total_count} conversation{'s' if total_count != 1 else ''}"
    
    return ConversationsListResponse(
        conversations=conversation_items,
        total=total_str
    )


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@router.get("/", response_model=APIInfoResponse)
async def root():
    """Root endpoint with API information."""
    return APIInfoResponse(
        message="Heritage RAG System API",
        description="Production-ready RAG system using LlamaIndex, LangChain, Qdrant, Supabase, and OpenRouter",
        version="1.0.0",
        endpoints={
            "upload": "/api/v1/upload",
            "new_chat": "/api/v1/chat/new",
            "continue_chat": "/api/v1/chat/{conversation_id}",
            "conversations": "/api/v1/conversations",
            "conversation_messages": "/api/v1/conversations/{conversation_id}/messages",
            "health": "/api/v1/health"
        }
    )

