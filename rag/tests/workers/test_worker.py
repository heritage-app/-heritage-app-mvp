import pytest
from unittest.mock import AsyncMock, patch
from app.workers.ingestion_worker import process_document_job

@pytest.mark.asyncio
async def test_process_document_job_success(mock_mongo_client):
    """
    Test the ingestion worker logic for a successful processing flow.
    """
    job_id = "job-1"
    doc_id = "doc-1"
    
    # 1. Mock repository returns
    job_record = {"id": job_id, "document_id": doc_id, "status": "processing"}
    doc_record = {"id": doc_id, "storage_path": "path/file.pdf", "status": "queued"}
    
    mock_mongo_client._mock_collection.find_one_and_update.return_value = job_record
    
    # find_one side effects:
    # 1. job_repo.start_job -> update -> find_one (job)
    # 2. doc_repo.get_by_id -> find_one (doc)
    # 3. doc_repo.update_status -> update -> find_one (doc)
    # 4. job_repo.update (finish) -> update -> find_one (job)
    # 5. doc_repo.update_status (finish) -> update -> find_one (doc)
    mock_mongo_client._mock_collection.find_one.side_effect = [
        job_record,
        doc_record,
        doc_record,
        job_record,
        doc_record
    ]

    # 2. Mock indexing service
    with patch("app.workers.ingestion_worker.index_document_from_storage", new_callable=AsyncMock) as mock_index:
        mock_index.return_value = None
        
        # 3. Execute Worker Task
        await process_document_job(job_id)

        # 4. Assertions
        mock_index.assert_called_once()
        # index_document_from_storage(storage_path, metadata)
        args, _ = mock_index.call_args
        storage_path = args[0]
        metadata = args[1]
        
        assert storage_path == "path/file.pdf"
        assert metadata["document_id"] == doc_id
        
        # Verify Mongo was called for updates
        assert mock_mongo_client._mock_collection.find_one_and_update.called

@pytest.mark.asyncio
async def test_process_document_job_failure(mock_mongo_client):
    """
    Test the ingestion worker logic for a failing processing flow.
    """
    job_id = "job-fail"
    doc_id = "doc-fail"
    
    job_record = {"id": job_id, "document_id": doc_id, "status": "processing"}
    doc_record = {"id": doc_id, "storage_path": "error.pdf"}
    
    mock_mongo_client._mock_collection.find_one_and_update.return_value = job_record
    
    mock_mongo_client._mock_collection.find_one.side_effect = [
        job_record, # start_job
        doc_record, # get_by_id
        doc_record, # update_status (processing)
        job_record, # update (failed)
        doc_record  # update_status (failed)
    ]

    with patch("app.workers.ingestion_worker.index_document_from_storage", new_callable=AsyncMock) as mock_index:
        # Simulate indexing failure
        mock_index.side_effect = Exception("Vector store connection failed")
        
        # 3. Execute Worker Task
        await process_document_job(job_id)

        # 4. Verifications
        # Verify last updates were status=failed
        update_calls = mock_mongo_client._mock_collection.find_one_and_update.call_args_list
        # Second to last is job update, last is doc update
        last_job_update = update_calls[-2][0][1]
        last_doc_update = update_calls[-1][0][1]
        
        assert last_job_update["$set"]["status"] == "failed"
        assert last_doc_update["$set"]["status"] == "failed"
