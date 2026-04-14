from typing import Optional
from supabase import AsyncClient
from app.core.config import settings

class SupabaseManager:
    """
    Singleton manager for Supabase AsyncClient.
    Note: Database operations have been migrated to MongoDB. 
    This client is now primarily used for Storage (bucket) operations.
    """
    _instance: Optional[AsyncClient] = None

    @classmethod
    async def get_client(cls) -> AsyncClient:
        """
        Returns the singleton Supabase AsyncClient instance.
        Initializes it if it doesn't exist.
        """
        if cls._instance is None:
            from supabase import AsyncClientOptions
            options = AsyncClientOptions(
                storage_client_timeout=120,  # 2 minute timeout for large archival uploads
                postgrest_client_timeout=60   # 1 minute timeout for general DB operations
            )
            cls._instance = await AsyncClient.create(
                settings.supabase_url,
                settings.supabase_key,
                options=options
            )
        return cls._instance

    @classmethod
    async def close(cls):
        """
        Closes the Supabase client connection reference.
        """
        if cls._instance:
            cls._instance = None

async def get_supabase() -> AsyncClient:
    """
    Convenience dependency for StorageService or other storage-related logic.
    """
    return await SupabaseManager.get_client()
