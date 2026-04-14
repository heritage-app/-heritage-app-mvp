from typing import Generic, TypeVar, List, Optional, Any, Dict
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError


# Type variable for the generic repository
T = TypeVar("T")

class BaseRepository(Generic[T]):
    """
    Base repository providing common CRUD operations for MongoDB.
    Uses the native PyMongo AsyncMongoClient.
    """
    
    def __init__(self, client: AsyncMongoClient, db_name: str, collection_name: str):
        self.client = client
        self.db = client[db_name]
        self.collection = self.db[collection_name]

    async def get_by_id(self, id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch a single record by its string ID.
        """
        try:
            return await self.collection.find_one({"id": id}, {"_id": 0})
        except PyMongoError:
            return None

    async def list(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """
        List records with pagination.
        """
        try:
            cursor = self.collection.find({}, {"_id": 0}).skip(offset).limit(limit)
            return await cursor.to_list(length=limit)
        except PyMongoError:
            return []

    async def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Insert a new record.
        """
        try:
            # We don't use MongoDB's internal _id for application logic to keep it simple
            # and compatible with the previous Supabase/UUID implementation.
            await self.collection.insert_one(data.copy())
            result = data.copy()
            if "_id" in result:
                del result["_id"]
            return result
        except PyMongoError:
            return {}

    async def update(self, id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Update a record by ID.
        """
        try:
            result = await self.collection.find_one_and_update(
                {"id": id},
                {"$set": data},
                projection={"_id": 0},
                return_document=True # Note: this might need Import from pymongo if Enum used
            )
            # In PyMongo 4.9+, find_one_and_update with ReturnDocument.AFTER 
            # (which is what we want) usually needs the Enum.
            # Simplified for now:
            updated = await self.collection.find_one({"id": id}, {"_id": 0})
            return updated
        except PyMongoError:
            return None

    async def delete(self, id: str) -> bool:
        """
        Delete a record by ID.
        """
        try:
            result = await self.collection.delete_one({"id": id})
            return result.deleted_count > 0
        except PyMongoError:
            return False

    async def count(self, query: Dict[str, Any] = None) -> int:
        """
        Count total documents matching a query.
        """
        try:
            return await self.collection.count_documents(query or {})
        except PyMongoError:
            return 0

    async def distinct(self, field: str, query: Dict[str, Any] = None) -> List[Any]:
        """
        Get distinct values for a field.
        """
        try:
            return await self.collection.distinct(field, query or {})
        except PyMongoError:
            return []
