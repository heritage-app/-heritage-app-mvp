import asyncio
import logging
from pymongo import AsyncMongoClient, ASCENDING
from app.core.config import settings
from app.storage.mongodb_client import MongoDBManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def initialize_mongodb():
    """
    Initializes MongoDB with required collections and indexes.
    """
    print(f"🚀 Initializing MongoDB for Heritage RAG...")
    
    try:
        client = await MongoDBManager.get_client()
        db = client[settings.mongodb_db_name]
        
        # 1. Verification of connection
        await client.admin.command('ping')
        print("📡 Successful connection to MongoDB.")

        # 2. Documents Collection & Indexes
        print("📂 Setting up 'documents' collection...")
        docs = db["documents"]
        await docs.create_index([("id", ASCENDING)], unique=True)
        await docs.create_index([("file_hash", ASCENDING)])
        await docs.create_index([("status", ASCENDING)])
        
        # 3. Chat Sessions Collection & Indexes
        print("💬 Setting up 'chat_sessions' collection...")
        sessions = db["chat_sessions"]
        await sessions.create_index([("id", ASCENDING)], unique=True)
        await sessions.create_index([("status", ASCENDING)])
        await sessions.create_index([("updated_at", ASCENDING)])

        # 4. Ingestion Jobs Collection & Indexes
        print("⚙️ Setting up 'ingestion_jobs' collection...")
        jobs = db["ingestion_jobs"]
        await jobs.create_index([("id", ASCENDING)], unique=True)
        await jobs.create_index([("document_id", ASCENDING)])
        await jobs.create_index([("status", ASCENDING)])
        await jobs.create_index([("created_at", ASCENDING)])

        print("✅ MongoDB initialization complete!")

    except Exception as e:
        logger.error(f"❌ Failed to initialize MongoDB: {e}")
        raise
    finally:
        await MongoDBManager.close()

if __name__ == "__main__":
    asyncio.run(initialize_mongodb())
