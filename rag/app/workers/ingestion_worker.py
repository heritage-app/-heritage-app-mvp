import logging
from datetime import datetime, timezone
from app.core.config import settings
from app.storage.mongodb_client import get_mongodb
from app.storage.repositories.documents import DocumentRepository
from app.storage.repositories.ingestion_jobs import IngestionJobRepository
from app.rag.indexer import index_document_from_storage

logger = logging.getLogger(__name__)

async def process_document_job(job_id: str):
    """
    Background worker task to process a document ingestion job.
    Uses the State Machine: queued -> processing -> indexed/failed.
    Relies on MongoDB for metadata and Supabase for storage.
    """
    client = await get_mongodb()
    db_name = settings.mongodb_db_name
    
    doc_repo = DocumentRepository(client, db_name)
    job_repo = IngestionJobRepository(client, db_name)

    # 1. Start the job (Set status to 'processing' and mark heartbeat)
    job = await job_repo.start_job(job_id)
    if not job:
        logger.error(f"Failed to start job {job_id}: Job not found in MongoDB.")
        return

    document_id = job.get("document_id")
    document = await doc_repo.get_by_id(document_id)
    if not document:
        logger.error(f"Failed to process job {job_id}: Document {document_id} not found in MongoDB.")
        await job_repo.update(job_id, {"status": "failed", "error_message": "Document record missing"})
        return

    try:
        # 2. Update document status to processing
        await doc_repo.update_status(document_id, "processing")

        # 3. Execute Indexing
        # We pass the storage path and any source metadata
        storage_path = document.get("storage_path")
        metadata = document.get("source_metadata", {})
        # Ensure document_id is in metadata for qdrant filtering later
        metadata["document_id"] = str(document_id)

        logger.info(f"Starting indexing for document {document_id} (path: {storage_path})")
        
        # This function handles the actual retrieval from Supabase and indexing into Qdrant
        await index_document_from_storage(storage_path, metadata)

        # 4. Success: Update job and document status
        now = datetime.now(timezone.utc).isoformat()
        await job_repo.update(job_id, {
            "status": "indexed",
            "finished_at": now
        })
        await doc_repo.update_status(document_id, "indexed")
        logger.info(f"Successfully indexed document {document_id}")

    except Exception as e:
        logger.exception(f"Error processing ingestion job {job_id}: {str(e)}")
        # 5. Failure: Update job and document status
        await job_repo.update(job_id, {
            "status": "failed", 
            "error_message": str(e)
        })
        await doc_repo.update_status(document_id, "failed")
