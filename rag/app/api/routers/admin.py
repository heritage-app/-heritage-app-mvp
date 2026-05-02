import uuid
import json
import logging
from pathlib import Path
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from typing import List, Dict, Any, Optional
from app.api.deps import get_current_admin
from app.storage.providers import Repositories
from app.schemas.responses import (
    DocumentListResponse, DocumentListItem, UploadResponse,
    UserListResponse, UserListItem, SystemStatsResponse,
    RefinementPreviewResponse, RefineCommitRequest
)
from app.storage.supabase import upload_document, delete_document as supabase_delete_document
from app.rag.indexer import index_document_from_storage, index_refined_records, BibleRefiner
from app.rag.vector_store import collection_exists, get_qdrant_client
from qdrant_client import models
from app.rag.constants import COLLECTION_NAME
from datetime import datetime, timezone
import re
import asyncio
from functools import lru_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def slugify_filename(filename: str) -> str:
    """
    Sanitize a filename for use in storage paths.
    Maps Ga specific characters and replaces non-alphanumeric chars.
    """
    name = filename.lower()
    # Map Ga specific chars
    name = name.replace('ɛ', 'e').replace('ɔ', 'o').replace('ŋ', 'n')
    # Replace non-alphanumeric (keep dots and dashes) with underscores
    name = re.sub(r'[^a-z0-9\.\-]', '_', name)
    # Collapse multiple underscores
    name = re.sub(r'_+', '_', name)
    return name.strip('_')

@router.get("/stats", response_model=SystemStatsResponse)
async def get_system_stats(admin_id: str = Depends(get_current_admin)):
    """
    Get global system statistics for the admin dashboard.
    Optimized with parallel queries.
    """
    from app.storage.repositories.users import UserRepository
    
    doc_repo = await Repositories.docs()
    chat_repo = await Repositories.chat()
    
    # Parallel queries for better performance
    total_docs, registered_users, guest_chats, user_chats = await asyncio.gather(
        doc_repo.count(),
        UserRepository.count(),
        chat_repo.count({"user_id": {"$regex": "^guest_"}}),
        chat_repo.count({"user_id": {"$regex": "^(?!guest_)"}}),
    )
    
    return SystemStatsResponse(
        total_documents=total_docs,
        registered_users=registered_users,
        user_conversations=user_chats,
        guest_conversations=guest_chats,
        total_conversations=guest_chats + user_chats,
        status="operational",
        timestamp=datetime.now(timezone.utc).isoformat()
    )

@router.get("/documents", response_model=DocumentListResponse)
async def list_all_documents(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin_id: str = Depends(get_current_admin)
):
    """
    List all documents in the system.
    """
    doc_repo = await Repositories.docs()
    docs, total = await asyncio.gather(
        doc_repo.get_all_documents(limit=limit, offset=offset),
        doc_repo.count()
    )
    
    document_items = [
        DocumentListItem(
            id=doc.get("id"),
            original_filename=doc.get("original_filename", "Unknown"),
            public_url=doc.get("public_url", ""),
            status=doc.get("status", "unknown"),
            uploaded_at=doc.get("created_at")
        )
        for doc in docs
    ]
        
    return DocumentListResponse(
        documents=document_items,
        total=total
    )

@router.delete("/documents/{document_id}")
async def admin_delete_document(
    document_id: str,
    admin_id: str = Depends(get_current_admin)
):
    """
    Administratively delete any document from the system.
    Optimized with parallel deletion from stores.
    """
    doc_repo = await Repositories.docs()
    document = await doc_repo.get_by_id(document_id)
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    storage_path = document.get("storage_path")
    error_results = []
    
    # Parallel deletion from Qdrant and Supabase
    async def delete_from_qdrant():
        if storage_path:
            try:
                doc_metadata = document.get("source_metadata", {})
                category = doc_metadata.get("category")
                from app.rag.constants import get_collection_name
                target_collection = get_collection_name(category)
                
                if collection_exists(target_collection):
                    client = get_qdrant_client()
                    client.delete(
                        collection_name=target_collection,
                        points_selector=models.Filter(
                            must=[models.FieldCondition(key="file_path", match=models.MatchValue(value=storage_path))]
                        )
                    )
                    logger.info(f"Vectors deleted from collection: {target_collection}")
            except Exception as e:
                logger.error(f"Vector deletion failed for {storage_path}: {e}")
                error_results.append(e)

    async def delete_from_supabase():
        if storage_path:
            try:
                await supabase_delete_document(storage_path)
                logger.info(f"Binary file deleted from Supabase: {storage_path}")
            except Exception as e:
                logger.error(f"Supabase deletion failed for {storage_path}: {e}")
                error_results.append(e)
    
    if storage_path:
        await asyncio.gather(delete_from_qdrant(), delete_from_supabase())
    
    # Delete from MongoDB
    await doc_repo.delete(document_id)
    logger.info(f"Record deleted from MongoDB: {document_id}")
    
    return {"status": "success", "message": f"Document {document_id} completely removed from Heritage system."}

@router.post("/upload", response_model=UploadResponse)
async def admin_upload_document(
    file: UploadFile = File(..., description="Document file to upload"),
    metadata: Optional[str] = Form(None, description="Optional JSON string metadata"),
    admin_id: str = Depends(get_current_admin)
):
    """
    [ADMIN ONLY] Upload a document to Supabase Storage and index it.
    Returns immediately, indexing runs in background.
    """
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        
        # Read file content upfront
        content = await file.read()
        file_size = len(content)
        
        original_filename = file.filename
        file_ext = Path(original_filename).suffix
        file_base = Path(original_filename).stem
        
        safe_base = slugify_filename(file_base)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        unique_file_path = f"{safe_base}_{timestamp}{file_ext}"
        
        # Calculate file size string
        file_size_str = None
        if file_size > 0:
            size_mb = file_size / (1024 * 1024)
            if size_mb < 1:
                file_size_str = f"{file_size / 1024:.2f} KB"
            else:
                file_size_str = f"{size_mb:.2f} MB"
        
        doc_metadata: dict = {}
        if metadata:
            try:
                doc_metadata = json.loads(metadata)
            except json.JSONDecodeError:
                pass
        
        doc_metadata["file_path"] = unique_file_path
        doc_metadata["filename"] = original_filename
        doc_metadata["uploaded_at"] = datetime.now(timezone.utc).isoformat()
        
        doc_repo = await Repositories.docs()
        doc_id = str(uuid.uuid4())
        await doc_repo.create({
            "id": doc_id,
            "user_id": admin_id,
            "original_filename": original_filename,
            "unique_path": unique_file_path,
            "public_url": "",
            "metadata": doc_metadata,
            "status": "uploading",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        from io import BytesIO
        from fastapi import UploadFile
        
        # Upload to Supabase first
        temp_file = UploadFile(filename=unique_file_path, file=BytesIO(content))
        public_url = await upload_document(temp_file, unique_file_path, overwrite=False)
        await doc_repo.update(doc_id, {"status": "uploaded", "public_url": public_url})
        
        # Background indexing task
        async def process_document():
            """Background task for indexing (file already uploaded)."""
            try:
                await doc_repo.update(doc_id, {"status": "indexing"})
                await index_document_from_storage(unique_file_path, doc_metadata)
                await doc_repo.update(doc_id, {"status": "indexed"})
                logger.info(f"Document indexed successfully: {doc_id}")
            except Exception as e:
                logger.error(f"Background indexing failed for {doc_id}: {e}")
                await doc_repo.update(doc_id, {"status": "error"})
        
        asyncio.create_task(process_document())
        
        category_msg = f" as category '{doc_metadata.get('category', 'general')}'" if 'category' in doc_metadata else ""
        
        return UploadResponse(
            status="success",
            file_name=original_filename,
            file_size=file_size_str,
            message=f"✅ Document '{unique_file_path}' uploaded. Indexing in progress{category_msg}...",
            file_url=public_url,
            next_step="Document will be searchable shortly."
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.post("/refine/preview", response_model=RefinementPreviewResponse)
async def admin_refine_preview(
    file: UploadFile = File(..., description="Bible document to preview refinement"),
    admin_id: str = Depends(get_current_admin)
):
    """
    [ADMIN ONLY] Extract and refine Bible data from a file for preview.
    Does NOT save to storage or index yet.
    """
    try:
        content = await file.read()
        preview_data = BibleRefiner.get_refinement_preview(content, file.filename)
        return RefinementPreviewResponse(**preview_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refinement preview failed: {str(e)}")


@router.post("/refine/commit", response_model=UploadResponse)
async def admin_refine_commit(
    request: RefineCommitRequest,
    admin_id: str = Depends(get_current_admin)
):
    """
    [ADMIN ONLY] Commit staged records to storage and index.
    Creates .json and .jsonl sidecars and triggers vector indexing.
    """
    try:
        records = request.staged_records
        filename = request.original_filename
        
        file_base = Path(filename).stem
        safe_base = slugify_filename(file_base)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        
        # 1. Create sidecar content
        json_content = json.dumps(records, ensure_ascii=False, indent=2).encode('utf-8')
        jsonl_content = "\n".join([json.dumps(r, ensure_ascii=False) for r in records]).encode('utf-8')
        
        # 2. Upload to storage
        json_path = f"refined/{safe_base}_{timestamp}_refined.json"
        jsonl_path = f"refined/{safe_base}_{timestamp}_refined.jsonl"
        
        # We need a mock UploadFile wrapper or use StorageService directly
        from app.storage.service import StorageService
        await StorageService.upload_file(jsonl_path, jsonl_content)
        public_url = StorageService.get_public_url(jsonl_path)
        
        # 3. Create Record in MongoDB
        doc_repo = await Repositories.docs()
        doc_id = str(uuid.uuid4())
        doc_metadata = {
            "category": "bible",
            "filename": filename,
            "unique_path": jsonl_path,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "verse_count": len(records)
        }
        
        await doc_repo.create({
            "id": doc_id,
            "user_id": admin_id,
            "original_filename": filename,
            "unique_path": jsonl_path,
            "public_url": public_url,
            "metadata": doc_metadata,
            "status": "indexing",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        # 4. Index in Vector Store
        await index_refined_records(records, doc_metadata)
        
        # 5. Finalize
        await doc_repo.update(doc_id, {"status": "indexed"})
        
        return UploadResponse(
            status="success",
            file_name=filename,
            file_size=f"{len(jsonl_content)/1024:.2f} KB",
            message=f"✅ {len(records)} Bible verses refined and indexed successfully!",
            file_url=public_url,
            next_step="These verses are now searchable in the archive."
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Refine commit failed: {str(e)}")

@router.get("/users", response_model=UserListResponse)
async def list_users_endpoint(
    limit: int = Query(50, description="Maximum number of users to retrieve", ge=1, le=100),
    offset: int = Query(0, description="Number of users to skip", ge=0),
    admin_id: str = Depends(get_current_admin)
):
    """
    [ADMIN ONLY] List all registered users from MongoDB.
    """
    from app.storage.repositories.users import UserRepository
    
    users = await UserRepository.get_all_users(limit=limit, offset=offset)
    total_users = await UserRepository.count()
    
    user_items = []
    for user_data in users:
        # Map MongoDB _id to id field for the schema
        user_items.append(
            UserListItem(
                id=str(user_data.get("_id")),
                email=user_data.get("email"),
                role=user_data.get("role"),
                display_name=user_data.get("display_name"),
                first_name=user_data.get("first_name"),
                last_name=user_data.get("last_name"),
                dob=user_data.get("dob"),
                created_at=user_data.get("created_at").isoformat() if isinstance(user_data.get("created_at"), datetime) else str(user_data.get("created_at"))
            )
        )
        
    return UserListResponse(
        users=user_items,
        total=total_users
    )

@router.patch("/users/{target_user_id}/role")
async def update_user_role_endpoint(
    target_user_id: str,
    role: str = Query(..., description="New role for the user ('admin', 'moderator', 'user')"),
    admin_id: str = Depends(get_current_admin)
):
    """
    [ADMIN ONLY] Update a user's role in MongoDB.
    """
    if role not in ["admin", "moderator", "user", "member"]:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'admin', 'moderator', 'user', or 'member'.")

    from app.storage.repositories.users import UserRepository
    
    success = await UserRepository.update_user_role(target_user_id, role)
    
    if not success:
        raise HTTPException(status_code=404, detail="User not found or role unchanged.")
        
    return {"status": "success", "message": f"User role updated to {role}."}
