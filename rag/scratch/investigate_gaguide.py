import asyncio
import os
from app.storage.providers import Repositories
from dotenv import load_dotenv

load_dotenv()

async def main():
    doc_repo = await Repositories.docs()
    docs = await doc_repo.get_all_documents(limit=100)
    
    # Target UUID from user
    target_prefix = "241209a7"
    doc = next((x for x in docs if x.get("id", "").startswith(target_prefix)), None)
    
    if not doc:
        # Fallback: search by name
        print(f"UUID prefix {target_prefix} not found. Searching by filename...")
        doc = next((x for x in docs if "gaguide" in x.get("original_filename", "").lower()), None)

    if doc:
        print(f"--- Document Record Found ---")
        print(f"ID: {doc.get('id')}")
        print(f"File: {doc.get('original_filename')}")
        print(f"Status: {doc.get('status')}")
        print(f"Unique Path: {doc.get('unique_path')}")
        print(f"Metadata: {doc.get('metadata')}")
        print(f"Created At: {doc.get('created_at')}")
        
        # Check Qdrant for this specific path
        from qdrant_client import QdrantClient
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        
        client = QdrantClient(url=os.getenv('QDRANT_URL'), api_key=os.getenv('QDRANT_API_KEY'))
        
        # Check all possible collections
        collections = ["heritage_documents", "stories_documents", "bibele_documents"]
        for coll in collections:
            try:
                res = client.scroll(
                    collection_name=coll,
                    scroll_filter=Filter(
                        must=[FieldCondition(key="file_path", match=MatchValue(value=doc.get('unique_path')))]
                    ),
                    limit=5
                )
                points = res[0]
                print(f"Collection '{coll}': Found {len(points)} points for this path.")
            except Exception as e:
                print(f"Error checking {coll}: {e}")
    else:
        print("Document record not found in MongoDB.")

if __name__ == "__main__":
    asyncio.run(main())
