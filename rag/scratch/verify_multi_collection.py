import asyncio
from app.rag.indexer import index_local_document
from app.rag.vector_store import get_qdrant_client
from app.rag.constants import COLLECTION_MAP

async def verify_multi_collection():
    client = get_qdrant_client()
    
    # 1. Test Bible
    file_path = r"c:\Users\pc\Desktop\wqs\docs\genesis_ga_en.md"
    print(f"Indexing {file_path} for auto-detection...")
    await index_local_document(file_path)
    
    # Check bible_documents collection
    try:
        coll_info = client.get_collection("bible_documents")
        print(f"✅ bible_documents collection exists with {coll_info.points_count} points.")
    except Exception as e:
        print(f"❌ bible_documents check failed: {e}")

    # Check heritage_documents (the old one)
    # The new indexing should have detected 'bible' and skipped the default
    try:
        coll_info = client.get_collection("heritage_documents")
        print(f"ℹ️ heritage_documents has {coll_info.points_count} points.")
    except Exception as e:
        print(f"ℹ️ heritage_documents check failed: {e}")

if __name__ == "__main__":
    asyncio.run(verify_multi_collection())
