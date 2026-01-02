"""
API routes for the RAG system.
"""

import uuid
import json
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.rag.service import ask
from app.storage.supabase import upload_document, get_messages, list_conversations, get_conversation_title, conversation_exists, file_exists_in_storage, get_supabase_client
from app.rag.indexer import index_document_from_storage
from app.rag.vector_store import collection_exists
from app.core.config import settings
from app.schemas.requests import AskRequest, UploadRequest
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


@router.post("/upload", response_model=UploadResponse)
async def upload_document_endpoint(
    file: UploadFile = File(..., description="Document file to upload"),
    metadata: str | None = Query(None, description="Optional JSON string metadata")
):
    """
    Upload a document to Supabase Storage and index it.
    
    Args:
        file: Uploaded file
        metadata: Optional JSON string metadata
        
    Returns:
        UploadResponse: Upload status and file information
    """
    try:
        # Use original filename
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        
        # Use original filename as file path
        file_path = file.filename
        
        # Check if file already exists in storage
        if await file_exists_in_storage(file_path):
            # File already exists - return existing file info without uploading
            public_url = f"{settings.supabase_url}/storage/v1/object/public/{settings.supabase_bucket}/{file_path}"
            
            # Get file size for response (try to get from existing file)
            file_size_str = None
            try:
                # Try to get file info to determine size
                client = await get_supabase_client()
                file_info = await client.storage.from_(settings.supabase_bucket).info(file_path)
                if file_info and hasattr(file_info, 'metadata') and file_info.metadata:
                    size_bytes = file_info.metadata.get('size', 0)
                    if size_bytes:
                        size_mb = size_bytes / (1024 * 1024)
                        if size_mb < 1:
                            file_size_str = f"{size_bytes / 1024:.2f} KB"
                        else:
                            file_size_str = f"{size_mb:.2f} MB"
            except Exception:
                pass
            
            # Check if file is indexed, if not, index it
            from app.rag.indexer import is_document_indexed
            is_indexed = await is_document_indexed(file_path)
            
            if not is_indexed:
                # File exists but not indexed - index it now
                try:
                    doc_metadata = {"file_path": file_path, "filename": file.filename}
                    await index_document_from_storage(file_path, doc_metadata)
                    message = "⚠️ File already exists in storage. Indexed it for you."
                    next_step = "The file is now indexed and ready for questions."
                except Exception as e:
                    message = f"⚠️ File already exists in storage, but indexing failed: {str(e)}"
                    next_step = "The file exists but may not be searchable yet."
            else:
                message = "⚠️ File already exists in storage. Skipping upload."
                next_step = "The file is already available and indexed. You can ask questions about it."
            
            return UploadResponse(
                status="exists",
                file_name=file.filename or file_path,
                file_size=file_size_str,
                message=message,
                file_url=public_url,
                next_step=next_step
            )
        
        # Get file size before uploading (read content once)
        file_size_str = None
        try:
            # Read file content to get size
            content = await file.read()
            file_size = len(content)
            
            if file_size > 0:
                size_mb = file_size / (1024 * 1024)
                if size_mb < 1:
                    file_size_str = f"{file_size / 1024:.2f} KB"
                else:
                    file_size_str = f"{size_mb:.2f} MB"
            
            # Reset file pointer for upload_document
            await file.seek(0)
        except Exception:
            # If we can't get file size, just skip it
            file_size_str = None
        
        # Upload to Supabase Storage (file doesn't exist, so upload it)
        public_url = await upload_document(file, file_path, overwrite=False)
        
        # Parse metadata if provided
        doc_metadata: dict = {}
        if metadata:
            try:
                doc_metadata = json.loads(metadata)
            except json.JSONDecodeError:
                pass
        
        doc_metadata["file_path"] = file_path
        doc_metadata["filename"] = file.filename
        
        # Index the document after upload
        await index_document_from_storage(file_path, doc_metadata)
        
        return UploadResponse(
            status="success",
            file_name=file.filename or file_path,
            file_size=file_size_str,
            message="✅ Document uploaded and indexed successfully!",
            file_url=public_url,
            next_step="You can now ask questions about this document."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.post("/chat/new")
async def new_chat_endpoint(
    request: AskRequest,
    top_k: int = Query(5, description="Number of context chunks to retrieve", ge=1, le=20),
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
        from app.storage.supabase import save_message
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
        from app.storage.supabase import save_message
        saved_message = await save_message(conversation_id, "user", request.query)
        conversation_id = saved_message.get("conversation_id")
        
        # Call ask with skip_user_message=True since we already saved it
        response_chunks = []
        async for chunk in ask(request.query, conversation_id, top_k=top_k, stream=False, skip_user_message=True):
            response_chunks.append(chunk)
        
        return AskResponse(
            conversation_id=conversation_id,
            response="".join(response_chunks),
            query=request.query
        )


@router.post("/chat/{conversation_id}")
async def continue_chat_endpoint(
    conversation_id: str,
    request: AskRequest,
    top_k: int = Query(5, description="Number of context chunks to retrieve", ge=1, le=20),
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
        from app.storage.supabase import save_message
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
        from app.storage.supabase import save_message
        saved_message = await save_message(conversation_id, "user", request.query)
        conversation_id = saved_message.get("conversation_id")
        
        # Call ask with skip_user_message=True since we already saved it
        response_chunks = []
        async for chunk in ask(request.query, conversation_id, top_k=top_k, stream=False, skip_user_message=True):
            response_chunks.append(chunk)
        
        return AskResponse(
            conversation_id=conversation_id,
            response="".join(response_chunks),
            query=request.query
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
        
        message_responses.append(
            MessageResponse(
                id=str(msg.get("id", "")),
                conversation_id=msg.get("conversation_id", ""),
                role=msg.get("role", ""),
                content=msg.get("content", ""),
                metadata=msg.get("metadata", {}),
                created_at=created_at
            )
        )
    
    return ConversationResponse(
        conversation_id=conversation_id,
        title=title,
        messages=message_responses,
        total=len(message_responses)
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
    
    conversation_items = [
        ConversationListItem(
            conversation_id=conv.get("conversation_id", ""),
            title=conv.get("title"),
            last_message_at=conv.get("last_message_at")
        )
        for conv in conversations
    ]
    
    return ConversationsListResponse(
        conversations=conversation_items,
        total=len(conversation_items)
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
        endpoints={
            "upload": "/api/v1/upload",
            "new_chat": "/api/v1/chat/new",
            "continue_chat": "/api/v1/chat/{conversation_id}",
            "conversations": "/api/v1/conversations",
            "conversation_messages": "/api/v1/conversations/{conversation_id}/messages",
            "health": "/api/v1/health"
        }
    )

