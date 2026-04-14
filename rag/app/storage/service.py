from typing import List, Optional
from fastapi import UploadFile
from app.core.config import settings
from app.storage.supabase_client import get_supabase

class StorageService:
    """
    Service for interacting with Supabase Storage (S3-compatible).
    """
    
    @staticmethod
    async def upload_file(file_content: bytes, storage_path: str, content_type: str = "application/octet-stream") -> str:
        """
        Uploads bytes to the configured Supabase bucket.
        """
        client = await get_supabase()
        await client.storage.from_(settings.supabase_bucket).upload(
            path=storage_path,
            file=file_content,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        # Return the public URL
        return f"{settings.supabase_url}/storage/v1/object/public/{settings.supabase_bucket}/{storage_path}"

    @staticmethod
    async def download_file(storage_path: str) -> bytes:
        """
        Downloads a file from the configured Supabase bucket.
        """
        client = await get_supabase()
        return await client.storage.from_(settings.supabase_bucket).download(storage_path)

    @staticmethod
    async def delete_file(storage_path: str):
        """
        Deletes a file from the bucket.
        """
        client = await get_supabase()
        await client.storage.from_(settings.supabase_bucket).remove([storage_path])
