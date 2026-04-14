import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.vector_store import get_qdrant_client
from app.rag.constants import COLLECTION_MAP

def check_count():
    client = get_qdrant_client()
    collection = "bibele_documents"
    res = client.count(collection_name=collection)
    print(f"COLLECTION: {collection}")
    print(f"COUNT: {res.count}")

if __name__ == "__main__":
    check_count()
