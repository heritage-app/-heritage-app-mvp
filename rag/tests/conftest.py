import pytest
import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock
from httpx import AsyncClient as AsyncHTTPClient, ASGITransport

from app.main import app
from app.core.config import settings
from app.storage.mongodb_client import MongoDBManager
from app.storage.supabase_client import SupabaseManager

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session")
def test_app():
    """Fixture for the FastAPI application."""
    return app

@pytest.fixture
async def async_client(test_app) -> AsyncGenerator[AsyncHTTPClient, None]:
    """Fixture for the async HTTP client using the modern ASGITransport."""
    transport = ASGITransport(app=test_app)
    async with AsyncHTTPClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest.fixture
def mock_mongo_client():
    """Fixture to mock the MongoDB AsyncMongoClient."""
    mock_client = AsyncMock()
    mock_db = MagicMock()
    mock_collection = AsyncMock()
    
    # Setup the chain: client[db_name][collection_name]
    mock_client.__getitem__.return_value = mock_db
    mock_db.__getitem__.return_value = mock_collection
    
    # Store these on the mock for easy access in tests
    mock_client._mock_db = mock_db
    mock_client._mock_collection = mock_collection
    
    return mock_client

@pytest.fixture
def mock_supabase_client():
    """Fixture to mock the Supabase AsyncClient."""
    mock_client = AsyncMock()
    mock_storage = MagicMock()
    mock_bucket = AsyncMock()
    
    # Setup chain: client.storage.from_(bucket)
    mock_client.storage = mock_storage
    mock_storage.from_.return_value = mock_bucket
    
    mock_client._mock_storage = mock_storage
    mock_client._mock_bucket = mock_bucket
    
    return mock_client

@pytest.fixture(autouse=True)
def patch_database_managers(monkeypatch, mock_mongo_client, mock_supabase_client):
    """Automatically patch MongoDB and Supabase managers to use mocks during tests."""
    async def mock_get_mongodb():
        return mock_mongo_client
        
    async def mock_get_supabase():
        return mock_supabase_client

    monkeypatch.setattr("app.storage.mongodb_client.get_mongodb", mock_get_mongodb)
    monkeypatch.setattr("app.storage.mongodb_client.MongoDBManager.get_client", mock_get_mongodb)
    monkeypatch.setattr("app.storage.supabase_client.get_supabase", mock_get_supabase)
    monkeypatch.setattr("app.storage.supabase_client.SupabaseManager.get_client", mock_get_supabase)
