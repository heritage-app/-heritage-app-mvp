"""
Supabase Storage helper module.
This module now handles ONLY binary storage (S3-compatible) operations.
All database operations have been migrated to MongoDB.
"""

from typing import List, Optional
from fastapi import UploadFile
from app.storage.supabase_client import get_supabase

async def upload_document(file: UploadFile, storage_path: str, overwrite: bool = False) -> str:
    """
    Upload a document file to Supabase Storage.
    
    Args:
        file: FastAPI UploadFile object
        storage_path: Path in storage bucket
        overwrite: Whether to overwrite existing file
        
    Returns:
        str: Public URL to the uploaded file
    """
    client = await get_supabase()
    from app.core.config import settings
    
    # Read file content
    content = await file.read()
    
    # Upload to storage
    response = await client.storage.from_(settings.supabase_bucket).upload(
        path=storage_path,
        file=content,
        file_options={"upsert": "true" if overwrite else "false"}
    )
    
    # Get public URL
    # response is usually a path string or similar depending on the version of the library
    public_url = f"{settings.supabase_url}/storage/v1/object/public/{settings.supabase_bucket}/{storage_path}"
    
    return public_url


async def download_document(storage_path: str) -> bytes:
    """
    Download a document from Supabase Storage.
    """
    client = await get_supabase()
    from app.core.config import settings
    return await client.storage.from_(settings.supabase_bucket).download(storage_path)


async def list_storage_files() -> List[str]:
    """
    List all files in the Supabase Storage bucket.
    """
    client = await get_supabase()
    from app.core.config import settings
    
    response = await client.storage.from_(settings.supabase_bucket).list()
    
    # Extract file names from response
    files = []
    for item in response:
        if isinstance(item, dict) and "name" in item:
            files.append(item["name"])
        elif hasattr(item, "name"):
            files.append(item.name)
            
    return files


async def file_exists_in_storage(storage_path: str) -> bool:
    """
    Check if a file exists in Supabase Storage.
    """
    files = await list_storage_files()
    return storage_path in files


async def delete_document(storage_path: str) -> bool:
    """
    Delete a document from Supabase Storage.
    """
    client = await get_supabase()
    from app.core.config import settings
    
    try:
        await client.storage.from_(settings.supabase_bucket).remove([storage_path])
        return True
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to delete {storage_path} from Supabase: {e}")
        return False
