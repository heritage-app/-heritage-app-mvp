"""
MongoDB repository for fetching and saving user credentials and profiles.
"""
import uuid
import logging
from datetime import datetime
from typing import Optional, Dict, Any

from app.storage.mongodb_client import get_database

logger = logging.getLogger(__name__)

class UserRepository:
    COLLECTION_NAME = "users"

    @classmethod
    async def get_collection(cls):
        db = await get_database()
        return db[cls.COLLECTION_NAME]

    @classmethod
    async def get_user_by_email(cls, email: str) -> Optional[Dict[str, Any]]:
        """Find a user by normalized email."""
        collection = await cls.get_collection()
        return await collection.find_one({"email": email.lower()})

    @classmethod
    async def get_user_by_id(cls, user_id: str) -> Optional[Dict[str, Any]]:
        """Find a user by their UUID."""
        collection = await cls.get_collection()
        return await collection.find_one({"_id": user_id})

    @classmethod
    async def get_all_users(cls, limit: int = 50, offset: int = 0) -> list[Dict[str, Any]]:
        """Fetch a list of users with pagination."""
        collection = await cls.get_collection()
        cursor = collection.find().sort("created_at", -1).skip(offset).limit(limit)
        return await cursor.to_list(length=limit)

    @classmethod
    async def update_user(cls, user_id: str, data: Dict[str, Any]) -> bool:
        """Update any fields for a user by their ID."""
        collection = await cls.get_collection()
        # Ensure we don't accidentally update the _id
        if "_id" in data:
            del data["_id"]
        result = await collection.update_one(
            {"_id": user_id},
            {"$set": data}
        )
        return result.modified_count > 0

    @classmethod
    async def update_user_role(cls, user_id: str, role: str) -> bool:
        """Update a user's role by their ID."""
        collection = await cls.get_collection()
        result = await collection.update_one(
            {"_id": user_id},
            {"$set": {"role": role}}
        )
        return result.modified_count > 0

    @classmethod
    async def count(cls, filters: Optional[Dict[str, Any]] = None) -> int:
        """Count total users in the collection."""
        collection = await cls.get_collection()
        return await collection.count_documents(filters or {})

    @classmethod
    async def create_user(
        cls, 
        email: str, 
        hashed_password: str, 
        role: str = "member",
        display_name: str = ""
    ) -> Dict[str, Any]:
        """Create a new user with a generated UUID, hashed password, and default role."""
        collection = await cls.get_collection()
        
        # Check if email exists
        if await cls.get_user_by_email(email):
            raise ValueError("Email already registered")
            
        user_id = str(uuid.uuid4())
        
        # Default display name generated from email if empty
        if not display_name:
            display_name = email.split('@')[0]
            
        new_user = {
            "_id": user_id,
            "email": email.lower(),
            "hashed_password": hashed_password,
            "role": role,
            "display_name": display_name,
            "created_at": datetime.utcnow()
        }
        
        await collection.insert_one(new_user)
        return new_user

