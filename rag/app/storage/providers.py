from app.storage.mongodb_client import get_database
from app.storage.repositories.chat_sessions import ChatSessionRepository
from app.storage.repositories.messages import MessageRepository
from app.storage.repositories.documents import DocumentRepository
from app.storage.repositories.ingestion_jobs import IngestionJobRepository
from app.core.config import settings

class Repositories:
    """
    Convenience provider for MongoDB repositories.
    """
    _chat: ChatSessionRepository = None
    _messages: MessageRepository = None
    _docs: DocumentRepository = None
    _jobs: IngestionJobRepository = None

    @classmethod
    async def chat(cls) -> ChatSessionRepository:
        if not cls._chat:
            db = await get_database()
            cls._chat = ChatSessionRepository(db.client, settings.mongodb_db_name)
        return cls._chat

    @classmethod
    async def messages(cls) -> MessageRepository:
        if not cls._messages:
            db = await get_database()
            cls._messages = MessageRepository(db.client, settings.mongodb_db_name)
        return cls._messages

    @classmethod
    async def docs(cls) -> DocumentRepository:
        if not cls._docs:
            db = await get_database()
            cls._docs = DocumentRepository(db.client, settings.mongodb_db_name)
        return cls._docs

    @classmethod
    async def jobs(cls) -> IngestionJobRepository:
        if not cls._jobs:
            db = await get_database()
            cls._jobs = IngestionJobRepository(db.client, settings.mongodb_db_name)
        return cls._jobs
