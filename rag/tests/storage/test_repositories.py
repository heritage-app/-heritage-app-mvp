import pytest
from unittest.mock import AsyncMock, MagicMock
from app.storage.repositories.base import BaseRepository
from app.storage.repositories.documents import DocumentRepository
from app.storage.repositories.chat_sessions import ChatSessionRepository
from app.storage.repositories.ingestion_jobs import IngestionJobRepository

@pytest.mark.asyncio
async def test_base_repository_get_by_id(mock_mongo_client):
    repo = BaseRepository(mock_mongo_client, "test_db", "test_col")
    
    # Mock return value for find_one
    mock_mongo_client._mock_collection.find_one.return_value = {"id": "123", "name": "test"}
    
    result = await repo.get_by_id("123")
    
    assert result == {"id": "123", "name": "test"}
    mock_mongo_client._mock_collection.find_one.assert_called_once_with({"id": "123"}, {"_id": 0})

@pytest.mark.asyncio
async def test_document_repository_get_by_hash(mock_mongo_client):
    repo = DocumentRepository(mock_mongo_client, "test_db")
    
    mock_mongo_client._mock_collection.find_one.return_value = {"id": "doc1", "file_hash": "hash123"}
    
    result = await repo.get_by_hash("hash123")
    
    assert result["id"] == "doc1"
    mock_mongo_client._mock_collection.find_one.assert_called_once_with({"file_hash": "hash123"}, {"_id": 0})

@pytest.mark.asyncio
async def test_chat_session_initialize(mock_mongo_client):
    repo = ChatSessionRepository(mock_mongo_client, "test_db")
    
    # Mock insert_one
    mock_mongo_client._mock_collection.insert_one.return_value = MagicMock(inserted_id="obj_id")
    
    result = await repo.initialize_session("Test Title")
    
    assert result["title"] == "Test Title"
    assert "id" in result
    assert result["status"] == "active"
    assert mock_mongo_client._mock_collection.insert_one.called

@pytest.mark.asyncio
async def test_ingestion_job_get_zombie_jobs(mock_mongo_client):
    repo = IngestionJobRepository(mock_mongo_client, "test_db")
    
    # In PyMongo, .find() is a synchronous call that returns a cursor.
    # Our mock_collection is an AsyncMock, so we must explicitly make .find a regular MagicMock.
    mock_cursor = AsyncMock()
    mock_cursor.to_list.return_value = [{"id": "job1", "status": "processing"}]
    
    # Replace the AsyncMock .find with a synchronous MagicMock returning our mock cursor
    mock_mongo_client._mock_collection.find = MagicMock(return_value=mock_cursor)
    
    zombies = await repo.get_zombie_jobs(timeout_minutes=10)
    
    assert len(zombies) == 1
    assert zombies[0]["id"] == "job1"
    
    # Verify find call contains status=processing and $lt filter
    args, kwargs = mock_mongo_client._mock_collection.find.call_args
    assert args[0]["status"] == "processing"
    assert "$lt" in args[0]["heartbeat_at"]

@pytest.mark.asyncio
async def test_base_repository_delete(mock_mongo_client):
    repo = BaseRepository(mock_mongo_client, "test_db", "test_col")
    
    mock_mongo_client._mock_collection.delete_one.return_value = MagicMock(deleted_count=1)
    
    success = await repo.delete("123")
    
    assert success is True
    mock_mongo_client._mock_collection.delete_one.assert_called_once_with({"id": "123"})
