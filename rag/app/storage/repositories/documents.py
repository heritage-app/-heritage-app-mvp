from typing import Optional, Dict, Any, List
from pymongo import AsyncMongoClient, DESCENDING
from .base import BaseRepository

class DocumentRepository(BaseRepository):
    """
    Repository for interacting with the documents collection in MongoDB.
    """
    def __init__(self, client: AsyncMongoClient, db_name: str):
        super().__init__(client, db_name, "documents")

    async def get_by_hash(self, file_hash: str) -> Optional[Dict[str, Any]]:
        """
        Check if a file with this hash already exists (for deduplication).
        """
        return await self.collection.find_one({"file_hash": file_hash}, {"_id": 0})

    async def get_all_documents(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """
        Retrieves all documents in the system (Admin only).
        """
        cursor = self.collection.find({}, {"_id": 0}).sort("created_at", DESCENDING).skip(offset).limit(limit)
        return await cursor.to_list(length=limit)

    async def get_user_documents(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves all documents uploaded by a specific user.
        """
        cursor = self.collection.find({"user_id": user_id}, {"_id": 0}).sort("created_at", DESCENDING).limit(limit)
        return await cursor.to_list(length=limit)

    async def get_by_id_and_user(self, document_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a document specifically owned by a user for security.
        """
        return await self.collection.find_one({"id": document_id, "user_id": user_id}, {"_id": 0})

    async def update_status(self, document_id: str, status: str) -> Optional[Dict[str, Any]]:
        """
        Quick helper to update document processing status.
        """
        return await self.update(document_id, {"status": status})
