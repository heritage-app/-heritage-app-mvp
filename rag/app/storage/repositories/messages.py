from typing import List, Dict, Any, Optional
from pymongo import AsyncMongoClient, ASCENDING
from .base import BaseRepository

class MessageRepository(BaseRepository):
    """
    Repository for interacting with the interaction documents in MongoDB.
    Each document contains a user query and the assistant's response.
    Supports separate collections for registered users and transient guests.
    """
    def __init__(self, client: AsyncMongoClient, db_name: str):
        super().__init__(client, db_name, "interactions")
        self.guest_collection = self.db["guest_interactions"]

    def _get_collection(self, user_id: Optional[str]):
        """
        Routes the request to the appropriate collection based on user_id prefix.
        """
        if user_id and user_id.startswith("guest_"):
            return self.guest_collection
        return self.collection

    async def ensure_ttl_indexes(self):
        """
        Ensure TTL index on guest_interactions to auto-expire documents after 24 hours.
        """
        try:
            # 86400 seconds = 24 hours
            await self.guest_collection.create_index("created_at", expireAfterSeconds=86400)
        except Exception as e:
            print(f"Warning: Failed to create TTL index: {e}")

    async def get_by_conversation(self, conversation_id: str, user_id: str = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Retrieves all interactions for a specific conversation, ordered by creation time.
        """
        query = {"conversation_id": conversation_id}
        collection = self._get_collection(user_id)
        
        cursor = collection.find(query, {"_id": 0}).sort("created_at", ASCENDING)
        
        if limit:
            cursor = cursor.limit(limit)
            
        return await cursor.to_list(length=limit or 1000)

    async def delete_by_conversation(self, conversation_id: str, user_id: str = None) -> bool:
        """
        Deletes all interactions for a specific conversation.
        """
        collection = self._get_collection(user_id)
        result = await collection.delete_many({"conversation_id": conversation_id})
        return result.deleted_count > 0

    async def save_interaction(
        self, 
        conversation_id: str, 
        query: str, 
        response: str, 
        user_id: str = None, 
        interaction_id: str = None,
        metadata: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        Creates a single interaction turn (query + response).
        """
        from datetime import datetime, timezone
        import uuid
        
        collection = self._get_collection(user_id)
        
        data = {
            "id": interaction_id or str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "user_id": user_id,
            "query": query,
            "response": response,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc) # Use datetime object for TTL index compatibility
        }
        
        # We manually insert instead of using self.create (which uses self.collection)
        await collection.insert_one(data.copy())
        result = data.copy()
        if "_id" in result:
            del result["_id"]
        
        # Ensure created_at is returned as ISO string for frontend/memory consistency 
        # if the rest of the app expects strings, but MongoDB prefers datetime for TTL.
        result["created_at"] = result["created_at"].isoformat()
        return result
