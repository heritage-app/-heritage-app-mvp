import json
import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks

from app.core.config import settings
from app.storage.mongodb_client import get_mongodb
from app.storage.service import StorageService
from app.storage.repositories.documents import DocumentRepository
from app.storage.repositories.ingestion_jobs import IngestionJobRepository
from app.schemas.documents.models import UploadResponse
from app.workers.ingestion_worker import process_document_job

router = APIRouter(prefix="/documents", tags=["documents"])

@router.post("/upload", response_model=UploadResponse)
async def upload_document_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(None)
):
    """
    Upload a document, create a MongoDB record, and trigger background ingestion.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    # Use MongoDB for metadata and Supabase for actual file storage
    client = await get_mongodb()
    db_name = settings.mongodb_db_name
    doc_repo = DocumentRepository(client, db_name)
    job_repo = IngestionJobRepository(client, db_name)

    # 1. Read file content to generate hash and for upload
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()

    # 2. Check for duplicate (by hash)
    existing_doc = await doc_repo.get_by_hash(file_hash)
    if existing_doc:
        # Re-uploading the same file. We'll proceed but could add versioning later.
        pass

    # 3. Generate unique storage path
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    file_ext = Path(file.filename).suffix
    file_stem = Path(file.filename).stem
    storage_path = f"{file_stem}_{timestamp}{file_ext}"

    # 4. Upload to Supabase Storage
    try:
        # StorageService still uses Supabase internally
        public_url = await StorageService.upload_file(
            file_content=content,
            storage_path=storage_path,
            content_type=file.content_type or "application/octet-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload to Supabase storage: {str(e)}")

    # 5. Parse metadata
    doc_metadata = {}
    if metadata:
        try:
            doc_metadata = json.loads(metadata)
        except json.JSONDecodeError:
            pass
    
    # 6. Create Document record in MongoDB
    doc_id = str(uuid.uuid4())
    doc_data = {
        "id": doc_id,
        "filename": file.filename,
        "storage_bucket": settings.supabase_bucket,
        "storage_path": storage_path,
        "public_url": public_url,
        "mime_type": file.content_type,
        "size_bytes": len(content),
        "file_hash": file_hash,
        "source_metadata": doc_metadata,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    new_doc = await doc_repo.create(doc_data)
    if not new_doc:
        raise HTTPException(status_code=500, detail="Failed to create document record in MongoDB")

    # 7. Create Ingestion Job in MongoDB
    job_id = str(uuid.uuid4())
    job_data = {
        "id": job_id,
        "document_id": doc_id,
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    new_job = await job_repo.create(job_data)
    if not new_job:
        raise HTTPException(status_code=500, detail="Failed to create ingestion job in MongoDB")

    # 8. Trigger Background task
    background_tasks.add_task(process_document_job, job_id)

    return UploadResponse(
        document_id=doc_id,
        job_id=job_id,
        status="queued",
        filename=file.filename
    )

@router.get("/{document_id}/status")
async def get_document_status(document_id: str):
    """
    Check the ingestion status of a document from MongoDB.
    """
    client = await get_mongodb()
    db_name = settings.mongodb_db_name
    doc_repo = DocumentRepository(client, db_name)
    job_repo = IngestionJobRepository(client, db_name)

    doc = await doc_repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    job = await job_repo.get_by_document_id(document_id)
    
    return {
        "document_id": document_id,
        "document_status": doc.get("status"),
        "job_status": job.get("status") if job else "unknown",
        "error_message": job.get("error_message") if job else None
    }
