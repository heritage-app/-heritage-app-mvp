import sys
import os
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app.rag.vector_store import get_qdrant_client

def clear_bible_collection():
    collection_name = "bibele_documents"
    print(f"🧹 Attempting to clear collection: {collection_name}")
    
    client = get_qdrant_client()
    try:
        # Check if collection exists first
        collections = client.get_collections().collections
        exists = any(c.name == collection_name for c in collections)
        
        if exists:
            client.delete_collection(collection_name=collection_name)
            print(f"✅ Successfully deleted collection: {collection_name}")
        else:
            print(f"⚠️ Collection '{collection_name}' does not exist. No action needed.")
            
    except Exception as e:
        print(f"❌ Error clearing collection: {e}")

if __name__ == "__main__":
    clear_bible_collection()
