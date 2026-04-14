import asyncio
import os
import sys
from pathlib import Path

# Add app directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.rag.indexer import index_local_document
from app.rag.vector_store import get_qdrant_client
from app.rag.constants import COLLECTION_MAP

async def reindex_bible():
    bible_collection = COLLECTION_MAP["bible"]
    client = get_qdrant_client()
    
    print(f"Clearing collection: {bible_collection}...")
    try:
        client.delete_collection(bible_collection)
        print("Collection deleted.")
    except Exception as e:
        print(f"Collection delete skipped (may not exist): {e}")

    # Re-create with proper config will happen automatically in index_local_document calls
    
    jsonl_path = r"c:\Users\pc\Desktop\wqs\docs\genesis_ga_en_verses.jsonl"
    print(f"Indexing {jsonl_path}...")
    
    if not os.path.exists(jsonl_path):
        print(f"ERROR: {jsonl_path} not found!")
        return

    await index_local_document(jsonl_path)
    print("Re-indexing complete!")

if __name__ == "__main__":
    asyncio.run(reindex_bible())
