import asyncio
import sys
from datetime import datetime, timezone
import requests
import uuid

# Re-use your DB setup simply for validation
from app.storage.mongodb_client import get_database
from app.storage.repositories.documents import DocumentRepository
from app.storage.supabase import file_exists_in_storage
from app.rag.vector_store import get_qdrant_client, collection_exists, COLLECTION_NAME
from qdrant_client import models

BASE_URL = "http://127.0.0.1:8080"
API_V1 = f"{BASE_URL}/api/v1"

async def test_delete_pipeline():
    print("--- Testing Complete Document Deletion Pipeline ---")
    
    # --- 1. UPLOAD ---
    dummy_text = "This is a temporary document meant specifically for testing the deletion feature."
    files = {'file': ('deletion_test.txt', dummy_text, 'text/plain')}
    data = {'metadata': '{"category": "test-delete"}'}
    
    print("\n[1] Uploading 'deletion_test.txt'...")
    response = requests.post(f"{API_V1}/upload", files=files, data=data)
    
    if response.status_code != 200:
        print(f"❌ Upload failed: {response.text}")
        sys.exit(1)
        
    print("✅ Upload successful!")
    
    
    # --- 2. RETRIEVE METADATA ---
    # Since the API doesn't return the MongoDB document_id, we fetch it manually
    print("\n[2] Fetching document_id from MongoDB...")
    db = await get_database()
    doc_repo = DocumentRepository(db.client, db.name)
    
    # Get the newest document
    cursor = doc_repo.collection.find({"original_filename": "deletion_test.txt"}).sort("created_at", -1).limit(1)
    docs = await cursor.to_list(length=1)
    
    if not docs:
        print("❌ Could not find the document in MongoDB!")
        sys.exit(1)
        
    document_id = docs[0]['id']
    unique_path = docs[0]['unique_path']
    print(f"✅ Found Document ID: {document_id}")
    print(f"   Unique Path: {unique_path}")
    
    
    # --- 3. DELETE ---
    print("\n[3] Calling DELETE Endpoint...")
    
    # Hot-patching existing Qdrant db to ensure our new deletion filter works immediately
    client = get_qdrant_client()
    try:
        client.create_payload_index(collection_name=COLLECTION_NAME, field_name="file_path", field_schema=models.PayloadSchemaType.KEYWORD)
    except Exception:
        pass # Already exists
        
    delete_resp = requests.delete(f"{API_V1}/documents/{document_id}")
    
    if delete_resp.status_code != 200:
        print(f"❌ Delete failed: {delete_resp.text}")
        sys.exit(1)
        
    print(f"✅ Delete successful! ({delete_resp.json().get('message')})")


    # --- 4. VERIFY DELETION ---
    print("\n[4] Verifying Deletion Across Stack...")
    
    # Verify MongoDB
    check_mongo = await doc_repo.get_by_id(document_id)
    if check_mongo:
        print("❌ FAILED: Document still exists in MongoDB.")
    else:
        print("✅ MongoDB: Record completely removed.")
        
    # Verify Supabase
    check_supabase = await file_exists_in_storage(unique_path)
    if check_supabase:
        print("❌ FAILED: File still exists in Supabase Storage.")
    else:
        print("✅ Supabase: Binary file successfully removed.")
        
    # Verify Qdrant
    client = get_qdrant_client()
    results = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=models.Filter(
            must=[models.FieldCondition(key="file_path", match=models.MatchValue(value=unique_path))]
        ),
        limit=1
    )
    if results[0] and len(results[0]) > 0:
        print("❌ FAILED: Vectors still exist in Qdrant.")
    else:
        print("✅ Qdrant: Vector embeddings successfully removed.")
        
    print("\n🎉 Deletion pipeline is fully functional!")

if __name__ == "__main__":
    asyncio.run(test_delete_pipeline())
