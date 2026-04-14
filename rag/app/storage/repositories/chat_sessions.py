from typing import Optional, Dict, Any, List
from pymongo import AsyncMongoClient, DESCENDING
from .base import BaseRepository

class ChatSessionRepository(BaseRepository):
    """
    Repository for interacting with the chat_sessions collection in MongoDB.
    """
    def __init__(self, client: AsyncMongoClient, db_name: str):
        super().__init__(client, db_name, "chat_sessions")

    async def get_recent_sessions(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves recent sessions for a specific user, ordered by updated_at.
        """
        cursor = (
            self.collection.find({"user_id": user_id}, {"_id": 0})
            .sort("updated_at", DESCENDING)
            .limit(limit)
        )
        return await cursor.to_list(length=limit)

    async def initialize_session(self, session_id: str, user_id: str, title: str = "New Chat") -> Dict[str, Any]:
        """
        Creates a new chat session with a specific ID and user owner.
        """
        from datetime import datetime, timezone
        
        now = datetime.now(timezone.utc).isoformat()
        
        data = {
            "id": session_id,
            "user_id": user_id,
            "title": title,
            "summary": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
            "metadata": {}
        }
        return await self.create(data)

    async def get_or_create(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """
        Gets a session or creates it if it doesn't exist. Verify owner.
        """
        session = await self.get_by_id_and_user(session_id, user_id)
        if not session:
            # Check if it exists for SOMEONE ELSE (security)
            existing = await self.get_by_id(session_id)
            if existing:
                # Should not happen in normal flow, but handle as 403-ish logic in routes
                return None
            session = await self.initialize_session(session_id, user_id)
        return session

    async def get_by_id_and_user(self, session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a session specifically owned by the user.
        """
        return await self.collection.find_one({"id": session_id, "user_id": user_id}, {"_id": 0})

    async def update_title(self, session_id: str, title: str) -> Optional[Dict[str, Any]]:
        """Update session title."""
        from datetime import datetime, timezone
        return await self.update(session_id, {
            "title": title,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

    async def update_summary(self, session_id: str, summary: str) -> Optional[Dict[str, Any]]:
        """Update session summary."""
        from datetime import datetime, timezone
        return await self.update(session_id, {
            "summary": summary,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

    async def update_activity(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Refresh the updated_at timestamp."""
        from datetime import datetime, timezone
        return await self.update(session_id, {
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
