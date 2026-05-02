import asyncio
from app.storage.mongodb_client import get_database
from app.storage.repositories.chat_sessions import ChatSessionRepository
from app.storage.repositories.messages import MessageRepository
from app.storage.repositories.documents import DocumentRepository
from app.storage.repositories.ingestion_jobs import IngestionJobRepository
from app.core.config import settings

class Repositories:
    """
    Convenience provider for MongoDB repositories with thread-safe initialization.
    """
    _chat: ChatSessionRepository = None
    _messages: MessageRepository = None
    _docs: DocumentRepository = None
    _jobs: IngestionJobRepository = None

    _init_locks = {
        "chat": asyncio.Lock(),
        "messages": asyncio.Lock(),
        "docs": asyncio.Lock(),
        "jobs": asyncio.Lock(),
    }

    @classmethod
    async def chat(cls) -> ChatSessionRepository:
        if cls._chat is None:
            async with cls._init_locks["chat"]:
                if cls._chat is None:
                    db = await get_database()
                    cls._chat = ChatSessionRepository(db.client, settings.mongodb_db_name)
        return cls._chat

    @classmethod
    async def messages(cls) -> MessageRepository:
        if cls._messages is None:
            async with cls._init_locks["messages"]:
                if cls._messages is None:
                    db = await get_database()
                    cls._messages = MessageRepository(db.client, settings.mongodb_db_name)
        return cls._messages

    @classmethod
    async def docs(cls) -> DocumentRepository:
        if cls._docs is None:
            async with cls._init_locks["docs"]:
                if cls._docs is None:
                    db = await get_database()
                    cls._docs = DocumentRepository(db.client, settings.mongodb_db_name)
        return cls._docs

    @classmethod
    async def jobs(cls) -> IngestionJobRepository:
        if cls._jobs is None:
            async with cls._init_locks["jobs"]:
                if cls._jobs is None:
                    db = await get_database()
                    cls._jobs = IngestionJobRepository(db.client, settings.mongodb_db_name)
        return cls._jobs
