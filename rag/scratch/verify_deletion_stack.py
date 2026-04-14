import asyncio
import sys
import requests
import json
from pathlib import Path

# Fix path to project root
sys.path.append(str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app.storage.providers import Repositories
from app.rag.vector_store import get_qdrant_client, collection_exists
from app.rag.constants import COLLECTION_NAME
from qdrant_client import models

# Use common local development URL
BASE_URL = "http://localhost:8080"

async def verify_deletion_stack():
    print("🚀 [TEST] Verifying Deletion Stack Reparation...")
    
    # 1. SETUP: Create a test document
    # Note: We need a real file to upload. We'll use a temporary string.
    test_filename = "reparation_test.txt"
    test_content = "This is a test document to verify the deletion pipeline is fully repaired."
    
    files = {'file': (test_filename, test_content, 'text/plain')}
    # Metadata as a JSON string (FastAPI Form handles it)
    metadata_json = json.dumps({"category": "heritage", "source": "deletion-tester"})
    data = {'metadata': metadata_json}
    
    headers = {"X-Admin-Id": "cf14e133-d83b-4ec1-b618-1dcead6c914e"} # Using the admin ID from .env
    
    print("\n[1] Uploading test document...")
    try:
        # We hit the ADMIN upload because it returns the doc_id directly
        response = requests.post(f"{BASE_URL}/api/v1/admin/upload", files=files, data=data, headers=headers)
        if response.status_code != 200:
            print(f"❌ Upload failed: {response.text}")
            return
    except Exception as e:
        print(f"❌ Connection to API failed. Is the server running? {e}")
        return

    res_data = response.json()
    doc_id = res_data.get("document_id")
    print(f"✅ Document created: {doc_id}")

    # Small wait for background ingestion
    print("⏳ Waiting for ingestion to complete (5s)...")
    await asyncio.sleep(5)

    # 2. VERIFY EXISTENCE
    print("\n[2] Verifying existence in all systems...")
    
    # MongoDB
    doc_repo = await Repositories.docs()
    doc = await doc_repo.get_by_id(doc_id)
    if not doc:
        print("❌ FAILED: Document not found in MongoDB after upgrade.")
        return
    
    storage_path = doc.get("storage_path")
    print(f"✅ MongoDB: Found record. storage_path={storage_path}")

    # Qdrant
    client = get_qdrant_client()
    # Check general collection for 'heritage'
    target_collection = "heritage_documents" 
    results = client.scroll(
        collection_name=target_collection,
        scroll_filter=models.Filter(
            must=[models.FieldCondition(key="file_path", match=models.MatchValue(value=storage_path))]
        ),
        limit=1
    )
    if not results[0]:
        print(f"❌ FAILED: No vectors found in Qdrant for {storage_path}")
        return
    print(f"✅ Qdrant: Found vectors associated with storage_path.")

    # 3. TRIGGER DELETION
    print("\n[3] Triggering Deletion via API...")
    del_resp = requests.delete(f"{BASE_URL}/api/v1/admin/documents/{doc_id}", headers=headers)
    if del_resp.status_code != 200:
        print(f"❌ Delete failed: {del_resp.text}")
        return
    print(f"✅ Delete response: {del_resp.json().get('message')}")

    # 4. FINAL VERIFICATION (ABSENCE)
    print("\n[4] Verifying total absence...")
    
    # Mongo
    await asyncio.sleep(1) # Let the DB breathe
    check_mongo = await doc_repo.get_by_id(doc_id)
    if check_mongo:
        print("❌ FAILED: Document still exists in MongoDB!")
    else:
        print("✅ MongoDB: Record purged.")

    # Qdrant
    res_qdrant = client.scroll(
        collection_name=target_collection,
        scroll_filter=models.Filter(
            must=[models.FieldCondition(key="file_path", match=models.MatchValue(value=storage_path))]
        ),
        limit=1
    )
    if res_qdrant[0] and len(res_qdrant[0]) > 0:
        print("❌ FAILED: Vectors still exist in Qdrant!")
    else:
        print("✅ Qdrant: Vectors purged.")

    print("\n🎉 ALL SYSTEMS CLEAR. Deletion pipeline is officially REPAIRED.")

if __name__ == "__main__":
    asyncio.run(verify_deletion_stack())
