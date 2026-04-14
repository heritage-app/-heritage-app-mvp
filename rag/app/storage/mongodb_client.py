from typing import Optional
from pymongo import AsyncMongoClient
from app.core.config import settings

class MongoDBManager:
    """
    Singleton manager for PyMongo AsyncMongoClient.
    """
    _client: Optional[AsyncMongoClient] = None

    @classmethod
    async def get_client(cls) -> AsyncMongoClient:
        """
        Returns the singleton AsyncMongoClient instance.
        Initializes it if it doesn't exist.
        """
        if cls._client is None:
            cls._client = AsyncMongoClient(settings.mongodb_uri)
        return cls._client

    @classmethod
    async def close(cls):
        """
        Closes the MongoDB client connection if it exists.
        """
        if cls._client:
            cls._client.close()
            cls._client = None

async def get_mongodb() -> AsyncMongoClient:
    """
    FastAPI dependency or direct helper for retrieving the MongoDB connection.
    """
    return await MongoDBManager.get_client()

async def get_database():
    """
    Helper to get the specific database instance.
    """
    client = await get_mongodb()
    return client[settings.mongodb_db_name]
