import pytest
from unittest.mock import AsyncMock, patch
from io import BytesIO

@pytest.mark.asyncio
async def test_upload_document_success(async_client, mock_mongo_client):
    """
    Test successful document upload flow.
    """
    # 1. Setup metadata and file mocks
    file_content = b"test file content"
    files = {"file": ("test.pdf", BytesIO(file_content), "application/pdf")}
    metadata = '{"source": "test", "author": "tester"}'
    
    # 2. Mock StorageService
    with patch("app.api.routers.documents.StorageService.upload_file", new_callable=AsyncMock) as mock_upload:
        mock_upload.return_value = "https://example.com/storage/test.pdf"
        
        # 3. Mock Mongo Repository interactions
        # Return none for duplicate check (not a duplicate)
        mock_mongo_client._mock_collection.find_one.return_value = None
        # Mock insert_one for both Document and IngestionJob
        mock_mongo_client._mock_collection.insert_one.return_value = AsyncMock()

        # 4. Perform Request
        response = await async_client.post(
            "/documents/upload",
            files=files,
            data={"metadata": metadata}
        )

        # 5. Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "test.pdf"
        assert data["status"] == "queued"
        assert "document_id" in data
        assert "job_id" in data
        
        # Verify storage was called
        mock_upload.assert_called_once()
        # Verify Mongo was called for creation (twice: once for doc, once for job)
        assert mock_mongo_client._mock_collection.insert_one.call_count == 2

@pytest.mark.asyncio
async def test_get_document_status_not_found(async_client, mock_mongo_client):
    """
    Test status retrieval for non-existent document.
    """
    mock_mongo_client._mock_collection.find_one.return_value = None
    
    response = await async_client.get("/documents/fake-id/status")
    
    assert response.status_code == 404
    assert response.json()["detail"] == "Document not found"

@pytest.mark.asyncio
async def test_get_document_status_success(async_client, mock_mongo_client):
    """
    Test successful status retrieval.
    """
    # First call for document repo, second for job repo
    mock_mongo_client._mock_collection.find_one.side_effect = [
        {"id": "doc123", "status": "indexed"},  # Document
        {"id": "job456", "status": "indexed", "error_message": None}  # Job
    ]
    
    response = await async_client.get("/documents/doc123/status")
    
    assert response.status_code == 200
    data = response.json()
    assert data["document_status"] == "indexed"
    assert data["job_status"] == "indexed"
