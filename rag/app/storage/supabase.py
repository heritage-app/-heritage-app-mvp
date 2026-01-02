"""
Supabase storage and database access module.
Uses Supabase client directly (no ORM) for database and storage operations.
"""

from datetime import datetime, timezone
from typing import List, Optional
from supabase import AsyncClient
from fastapi import UploadFile

from app.core.config import settings


_client: AsyncClient | None = None


async def get_supabase_client() -> AsyncClient:
    """Get Supabase AsyncClient instance."""
    global _client
    if _client is None:
        _client = await AsyncClient.create(
            settings.supabase_url,
            settings.supabase_key,
        )
    return _client


# ==================== Storage Operations ====================

async def file_exists_in_storage(file_path: str) -> bool:
    """
    Check if a file exists in Supabase Storage.
    
    Args:
        file_path: Path to file in bucket
        
    Returns:
        bool: True if file exists, False otherwise
    """
    client = await get_supabase_client()
    
    try:
        # Try to get file info - if it exists, this will succeed
        # If file doesn't exist, this will raise an exception
        await client.storage.from_(settings.supabase_bucket).info(file_path)
        return True
    except Exception:
        # File doesn't exist or error occurred
        return False


async def upload_document(file: UploadFile, file_path: str, overwrite: bool = False) -> str:
    """
    Upload document to Supabase Storage.
    
    Args:
        file: FastAPI UploadFile object
        file_path: Path to store file in bucket
        overwrite: If True, overwrite existing file. If False, skip if file exists.
        
    Returns:
        str: Public URL of uploaded file
        
    Raises:
        ValueError: If file already exists and overwrite is False
    """
    client = await get_supabase_client()
    
    # Check if file already exists
    if not overwrite and await file_exists_in_storage(file_path):
        raise ValueError(f"File '{file_path}' already exists in storage")
    
    # Read file content
    content = await file.read()
    
    # Upload to storage
    await client.storage.from_(settings.supabase_bucket).upload(
        path=file_path,
        file=content,
        file_options={"content-type": file.content_type or "application/octet-stream", "upsert": "true"}
    )
    
    # Get public URL (construct it manually since get_public_url might not be async or available)
    # Format: {supabase_url}/storage/v1/object/public/{bucket}/{path}
    public_url = f"{settings.supabase_url}/storage/v1/object/public/{settings.supabase_bucket}/{file_path}"
    
    return public_url


async def download_document(file_path: str) -> bytes:
    """
    Download document from Supabase Storage.
    
    Args:
        file_path: Path to file in bucket
        
    Returns:
        bytes: File content
    """
    client = await get_supabase_client()
    
    response = await client.storage.from_(settings.supabase_bucket).download(file_path)
    return response


async def list_storage_files() -> List[str]:
    """
    List all files in Supabase Storage bucket.
    
    Returns:
        List[str]: List of file paths in the bucket
    """
    client = await get_supabase_client()
    
    try:
        # List all files in the bucket (recursively)
        response = await client.storage.from_(settings.supabase_bucket).list()
        
        # Extract file paths from the response
        files = []
        if response:
            for item in response:
                # Handle both dict and string responses
                if isinstance(item, dict):
                    name = item.get("name")
                    if name:
                        # If it's a directory (ends with /), skip it
                        if not name.endswith("/"):
                            files.append(name)
                elif isinstance(item, str):
                    if not item.endswith("/"):
                        files.append(item)
        
        return files
    except Exception as e:
        # Log error but return empty list
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error listing storage files: {e}")
        return []


# ==================== Database Operations ====================

async def save_message(
    conversation_id: str | None,
    role: str,
    content: str,
    metadata: dict | None = None
) -> dict:
    """
    Save message to Supabase database.
    Generates conversation_id if not provided (for new conversations).
    
    Args:
        conversation_id: Unique conversation identifier (generated if None)
        role: Message role (user/assistant/system)
        content: Message content
        metadata: Optional metadata dict
        
    Returns:
        dict: Saved message record with conversation_id
    """
    import uuid
    
    client = await get_supabase_client()
    
    # Generate conversation_id if not provided
    if conversation_id is None:
        conversation_id = str(uuid.uuid4())
    
    message_data = {
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "metadata": metadata or {}
    }
    
    response = await client.table("messages").insert(message_data).execute()
    saved_message = response.data[0] if response.data else {}
    return saved_message


async def conversation_exists(conversation_id: str) -> bool:
    """
    Check if a conversation exists in the database.
    
    Args:
        conversation_id: Unique conversation identifier
        
    Returns:
        bool: True if conversation exists, False otherwise
    """
    client = await get_supabase_client()
    
    response = (
        await client.table("messages")
        .select("conversation_id", count="exact")
        .eq("conversation_id", conversation_id)
        .limit(1)
        .execute()
    )
    
    return response.count is not None and response.count > 0


async def get_messages(
    conversation_id: str,
    limit: Optional[int] = None
) -> List[dict]:
    """
    Get messages for a conversation from Supabase database.
    
    Args:
        conversation_id: Unique conversation identifier
        limit: Maximum number of messages to retrieve
        
    Returns:
        List[dict]: List of message records
    """
    client = await get_supabase_client()
    
    query = (
        client.table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=False)
    )
    
    if limit:
        query = query.limit(limit)
    
    response = await query.execute()
    return response.data or []


async def save_conversation_summary(
    conversation_id: str,
    summary: str,
    title: str | None = None
) -> dict:
    """
    Save conversation summary to Supabase database.
    Creates row if it doesn't exist, updates if it does.
    
    Args:
        conversation_id: Unique conversation identifier
        summary: Generated summary text
        title: Optional conversation title
        
    Returns:
        dict: Saved summary record
    """
    client = await get_supabase_client()
    
    # Check if row exists to preserve existing title
    existing = await client.table("conversation_summaries").select("*").eq("conversation_id", conversation_id).execute()
    
    summary_data = {
        "conversation_id": conversation_id,
        "summary": summary
    }
    
    # Preserve existing title if not being updated
    if existing.data and len(existing.data) > 0:
        existing_title = existing.data[0].get("title")
        if existing_title and not title:
            summary_data["title"] = existing_title
        elif title:
            summary_data["title"] = title
    elif title:
        summary_data["title"] = title
    
    # Upsert summary (update if exists, insert if not)
    # Since conversation_id is the primary key, upsert will update if exists, insert if not
    response = await client.table("conversation_summaries").upsert(
        summary_data
    ).execute()
    
    # Upsert returns the inserted/updated row
    if response.data and len(response.data) > 0:
        return response.data[0]
    
    # If no data returned, try to fetch it
    get_response = await client.table("conversation_summaries").select("*").eq("conversation_id", conversation_id).execute()
    if get_response.data and len(get_response.data) > 0:
        return get_response.data[0]
    
    return {}


async def get_conversation_summary(conversation_id: str) -> Optional[str]:
    """
    Get conversation summary from Supabase database.
    
    Args:
        conversation_id: Unique conversation identifier
        
    Returns:
        Optional[str]: Summary text if exists, None otherwise
    """
    client = await get_supabase_client()
    
    response = (
        await client.table("conversation_summaries")
        .select("summary")
        .eq("conversation_id", conversation_id)
        .execute()
    )
    
    if response.data:
        return response.data[0].get("summary")
    return None


async def get_conversation_title(conversation_id: str) -> Optional[str]:
    """
    Get conversation title from Supabase database.
    
    Args:
        conversation_id: Unique conversation identifier
        
    Returns:
        Optional[str]: Title text if exists, None otherwise
    """
    client = await get_supabase_client()
    
    response = (
        await client.table("conversation_summaries")
        .select("title")
        .eq("conversation_id", conversation_id)
        .execute()
    )
    
    if response.data:
        return response.data[0].get("title")
    return None


async def save_conversation_title(conversation_id: str, title: str) -> dict:
    """
    Save conversation title to Supabase database.
    Creates row if it doesn't exist, updates if it does.
    
    Args:
        conversation_id: Unique conversation identifier
        title: Generated title text
        
    Returns:
        dict: Saved summary record with title
    """
    client = await get_supabase_client()
    
    # Check if row exists to preserve existing summary
    existing = await client.table("conversation_summaries").select("*").eq("conversation_id", conversation_id).execute()
    
    # Prepare data for upsert
    title_data = {
        "conversation_id": conversation_id,
        "title": title
    }
    
    # Preserve existing summary if row exists, otherwise use empty string (required by NOT NULL constraint)
    if existing.data and len(existing.data) > 0:
        existing_summary = existing.data[0].get("summary")
        title_data["summary"] = existing_summary if existing_summary else ""
    else:
        # New row - initialize with empty summary (required by NOT NULL constraint)
        title_data["summary"] = ""
    
    # Use upsert to create or update the row (creates if doesn't exist, updates if exists)
    response = await client.table("conversation_summaries").upsert(title_data).execute()
    
    if response.data and len(response.data) > 0:
        return response.data[0]
    
    # Fetch the updated record if response didn't return data
    get_response = await client.table("conversation_summaries").select("*").eq("conversation_id", conversation_id).execute()
    if get_response.data and len(get_response.data) > 0:
        return get_response.data[0]
    
    return {}


async def list_conversations(limit: int = 50) -> List[dict]:
    """
    List all conversations with their latest message timestamp and title.
    
    Args:
        limit: Maximum number of conversations to retrieve
        
    Returns:
        List[dict]: List of conversation records with id, title, and latest message timestamp
    """
    client = await get_supabase_client()
    
    # Get unique conversation IDs with their latest message timestamp
    response = (
        await client.table("messages")
        .select("conversation_id, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    
    # Group by conversation_id and get the latest timestamp for each
    conversations_map = {}
    for msg in response.data or []:
        conv_id = msg.get("conversation_id")
        if conv_id and conv_id not in conversations_map:
            conversations_map[conv_id] = {
                "conversation_id": conv_id,
                "last_message_at": msg.get("created_at")
            }
    
    # Get titles from conversation_summaries table
    conversation_ids = list(conversations_map.keys())
    if conversation_ids:
        summaries_response = (
            await client.table("conversation_summaries")
            .select("conversation_id, title")
            .in_("conversation_id", conversation_ids)
            .execute()
        )
        
        # Map titles to conversations
        for summary in summaries_response.data or []:
            conv_id = summary.get("conversation_id")
            if conv_id in conversations_map:
                conversations_map[conv_id]["title"] = summary.get("title")
    
    # Convert to list and limit
    conversations = list(conversations_map.values())[:limit]
    return conversations
