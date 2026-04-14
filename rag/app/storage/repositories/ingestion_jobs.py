from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from pymongo import AsyncMongoClient, ASCENDING
from .base import BaseRepository

class IngestionJobRepository(BaseRepository):
    """
    Repository for managing the ingestion state machine in MongoDB.
    """
    def __init__(self, client: AsyncMongoClient, db_name: str):
        super().__init__(client, db_name, "ingestion_jobs")

    async def get_next_queued_job(self) -> Optional[Dict[str, Any]]:
        """
        Retrieves the oldest queued job to process.
        """
        return await self.collection.find_one(
            {"status": "queued"},
            {"_id": 0},
            sort=[("created_at", ASCENDING)]
        )

    async def start_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Marks a job as processing and sets the initial heartbeat.
        """
        now = datetime.now(timezone.utc).isoformat()
        return await self.update(job_id, {
            "status": "processing",
            "started_at": now,
            "heartbeat_at": now,
            "attempt_count": 1 # Initial attempt
        })

    async def update_heartbeat(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Updates the heartbeat to signify the worker is still alive.
        """
        return await self.update(job_id, {"heartbeat_at": datetime.now(timezone.utc).isoformat()})

    async def get_zombie_jobs(self, timeout_minutes: int = 30) -> List[Dict[str, Any]]:
        """
        Finds jobs stuck in 'processing' with a stale heartbeat.
        """
        timeout_threshold = (datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)).isoformat()
        cursor = self.collection.find({
            "status": "processing",
            "heartbeat_at": {"$lt": timeout_threshold}
        }, {"_id": 0})
        return await cursor.to_list(length=None)

    async def get_by_document_id(self, document_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves the ingestion job associated with a document.
        """
        return await self.collection.find_one({"document_id": document_id}, {"_id": 0})
