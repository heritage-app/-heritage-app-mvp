"""
API routes for the RAG system.
"""

import uuid
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Form, Depends
from fastapi.responses import StreamingResponse
from app.api.deps import get_current_user, get_optional_user, get_current_admin

from app.core.config import settings
from app.rag.constants import DEFAULT_TOP_K, COLLECTION_NAME
from app.storage.supabase import upload_document, delete_document
from app.schemas.requests import AskRequest, ProfileUpdate
from app.rag.indexer import index_document_from_storage
from app.rag.service import ask
from app.rag.vector_store import collection_exists, get_qdrant_client
from qdrant_client import models
from app.schemas.responses import (
    UploadResponse,
    AskResponse,
    MessageResponse,
    ConversationResponse,
    ConversationsListResponse,
    ConversationListItem,
    HealthResponse,
    APIInfoResponse,
    DocumentListResponse,
    DocumentListItem,
    UserListItem,
    UserListResponse
)
from app.storage.supabase_client import get_supabase
from app.storage.providers import Repositories
from app.api.routers import auth


router = APIRouter(prefix="/api/v1", tags=["rag"])

# Include sub-routers
router.include_router(auth.router, prefix="/auth", tags=["auth"])

def humanize_timestamp(timestamp_str: str | datetime | None) -> str:
    """
    Convert a timestamp string or datetime object to a human-readable format.
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


@router.get("/user/me")
async def get_my_profile_endpoint(
    user: any = Depends(get_current_user)
):
    """
    Get the profile information for the currently logged-in user from MongoDB.
    """
    user_id = str(user["_id"])
    
    # Check completeness
    is_complete = all([user.get("first_name"), user.get("last_name"), user.get("dob")])
    
    return {
        "id": user_id,
        "email": user.get("email"),
        "role": user.get("role", "member"),
        "display_name": user.get("display_name"),
        "first_name": user.get("first_name"),
        "last_name": user.get("last_name"),
        "dob": user.get("dob"),
        "is_complete": is_complete,
        "created_at": user.get("created_at").isoformat() if isinstance(user.get("created_at"), datetime) else str(user.get("created_at"))
    }


@router.patch("/user/me")
async def update_my_profile_endpoint(
    profile_data: ProfileUpdate,
    user: any = Depends(get_current_user)
):
    """
    Update the profile information for the currently logged-in user in MongoDB.
    """
    from app.storage.repositories.users import UserRepository
    user_id = str(user["_id"])
    
    update_data = profile_data.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields provided for update.")
    
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    success = await UserRepository.update_user(user_id, update_data)
    
    if not success:
        # It's possible the record exists but no fields changed
        pass
        
    # Re-fetch the updated user
    updated_user = await UserRepository.get_user_by_id(user_id)
        
    return {"status": "success", "profile": {
        "id": user_id,
        "email": updated_user.get("email"),
        "display_name": updated_user.get("display_name"),
        "first_name": updated_user.get("first_name"),
        "last_name": updated_user.get("last_name"),
        "dob": updated_user.get("dob")
    }}


@router.post("/chat/new")
async def new_chat_endpoint(
    request: AskRequest,
    top_k: int = Query(DEFAULT_TOP_K, description="Number of context chunks to retrieve", ge=1, le=20),
    stream: bool = Query(False, description="Whether to stream the response"),
    user_id: str = Depends(get_optional_user)
):
    """
    [PUBLIC/GUEST] Start a new chat conversation. 
    """
    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="User identification required.")

    if not collection_exists():
        raise HTTPException(status_code=503, detail="Vector store not initialized.")
    
    conversation_id = str(uuid.uuid4())
    chat_repo = await Repositories.chat()
    await chat_repo.initialize_session(conversation_id, user_id=user_id)
    
    if stream:
        return StreamingResponse(
            ask(request.query, conversation_id, user_id=user_id, top_k=top_k, stream=True, model=request.model, mode=request.mode),
            media_type="text/plain",
            headers={"X-Conversation-Id": conversation_id, "X-Content-Type-Options": "nosniff"}
        )
    else:
        response_chunks = []
        async for chunk in ask(request.query, conversation_id, user_id=user_id, top_k=top_k, stream=False, model=request.model, mode=request.mode):
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
    stream: bool = Query(False, description="Whether to stream the response"),
    user_id: str = Depends(get_optional_user)
):
    """
    [PUBLIC/GUEST] Continue an existing chat conversation.
    """
    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")
    
    if not user_id:
        raise HTTPException(status_code=401, detail="User identification required.")

    chat_repo = await Repositories.chat()
    session = await chat_repo.get_by_id_and_user(conversation_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    
    if not collection_exists():
        raise HTTPException(status_code=503, detail="Vector store not initialized.")
    
    if stream:
        return StreamingResponse(
            ask(request.query, conversation_id, user_id=user_id, top_k=top_k, stream=True, model=request.model, mode=request.mode),
            media_type="text/plain",
            headers={"X-Conversation-Id": conversation_id, "X-Content-Type-Options": "nosniff"}
        )
    else:
        response_chunks = []
        async for chunk in ask(request.query, conversation_id, user_id=user_id, top_k=top_k, stream=False, model=request.model, mode=request.mode):
            response_chunks.append(chunk)
        
        return AskResponse(
            conversation_id=conversation_id,
            response="".join(response_chunks),
            query=request.query,
            timestamp=datetime.now(timezone.utc).isoformat()
        )


@router.post("/bible/ask")
async def ask_bible_explicit(
    request: AskRequest,
    user_id: str = Depends(get_optional_user)
):
    """Dedicated explicit endpoint for Bible queries."""
    request.mode = "bible"
    return await new_chat_endpoint(request, user_id=user_id)


@router.post("/general/ask")
async def ask_general_explicit(
    request: AskRequest,
    user_id: str = Depends(get_optional_user)
):
    """Dedicated explicit endpoint for General Heritage queries."""
    request.mode = "general"
    return await new_chat_endpoint(request, user_id=user_id)


@router.get("/conversations/{conversation_id}/messages", response_model=ConversationResponse)
async def get_conversation_messages(
    conversation_id: str,
    limit: int | None = Query(None, description="Maximum number of turns to retrieve", ge=1, le=100),
    user_id: str = Depends(get_optional_user)
):
    """
    [PUBLIC/GUEST] Get messages for a given conversation.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="User identification required.")

    chat_repo = await Repositories.chat()
    session = await chat_repo.get_by_id_and_user(conversation_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msg_repo = await Repositories.messages()
    interactions = await msg_repo.get_by_conversation(conversation_id, user_id=user_id, limit=limit)
    
    message_responses = []
    for turn in interactions:
        created_at_str = turn.get("created_at")
        try:
            # Handle both datetime objects and ISO strings
            if isinstance(created_at_str, datetime):
                created_at = created_at_str
            else:
                created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            created_at = datetime.now(timezone.utc)
        
        # 1. Add User query as a message
        message_responses.append(
            MessageResponse(
                id=f"{turn.get('id', '')}_q",
                conversation_id=conversation_id,
                role="user",
                content=turn.get("query", ""),
                sent_at=humanize_timestamp(created_at),
                created_at=created_at
            )
        )
        
        # 2. Add Assistant response as a message
        if turn.get("response"):
            message_responses.append(
                MessageResponse(
                    id=f"{turn.get('id', '')}_a",
                    conversation_id=conversation_id,
                    role="assistant",
                    content=turn.get("response", ""),
                    sent_at=humanize_timestamp(created_at),
                    created_at=created_at
                )
            )
    
    return ConversationResponse(
        conversation_id=conversation_id,
        title=session.get("title"),
        messages=message_responses,
        total=f"{len(message_responses)} messages",
        last_activity=humanize_timestamp(session.get("updated_at"))
    )


@router.get("/conversations", response_model=ConversationsListResponse)
async def list_conversations_endpoint(
    limit: int = Query(50, description="Maximum number of conversations to retrieve", ge=1, le=100),
    user_id: str = Depends(get_optional_user)
):
    """
    [PUBLIC] List recent chat conversations.
    """
    if not user_id or user_id.startswith("guest_"):
        return ConversationsListResponse(conversations=[], total="0 conversations")

    chat_repo = await Repositories.chat()
    sessions = await chat_repo.get_recent_sessions(user_id, limit=limit)
    
    msg_repo = await Repositories.messages()
    
    conversation_items = []
    for sess in sessions:
        conv_id = sess.get("id")
        interactions = await msg_repo.get_by_conversation(conv_id, user_id=user_id, limit=1)
        
        last_message = None
        if interactions:
            # Use the query from the latest turn as physical last message preview
            content = interactions[0].get("query", "")
            last_message = content[:100] + "..." if len(content) > 100 else content
        
        conversation_items.append(
            ConversationListItem(
                conversation_id=conv_id,
                title=sess.get("title"),
                last_message=last_message,
                last_activity=humanize_timestamp(sess.get("updated_at")),
                message_count="Recent session"
            )
        )
    
    return ConversationsListResponse(
        conversations=conversation_items,
        total=f"{len(conversation_items)} conversations"
    )


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint with DB ping."""
    from app.storage.mongodb_client import get_database
    
    db_status = "connected"
    try:
        db = await get_database()
        # The admin command 'ping' is a lightweight way to check connectivity
        await db.command("ping")
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Health check DB ping failed: {e}")
        db_status = "disconnected"
    
    return HealthResponse(
        status="healthy" if db_status == "connected" else "degraded",
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@router.get("/", response_model=APIInfoResponse)
async def root():
    """Root endpoint with API information."""
    return APIInfoResponse(
        message="Heritage RAG System API (Mixed-Access Mode)",
        description="Public chat enabled with Admin-protected document management.",
        version="1.2.0",
        endpoints={
            "public_chat": "/chat/new",
            "admin_upload": "/admin/upload",
            "admin_list_documents": "/admin/documents",
            "admin_delete": "/admin/documents/{id}",
            "admin_users": "/admin/users",
            "admin_stats": "/admin/stats"
        }
    )
