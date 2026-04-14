import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.vector_store import get_qdrant_client
from qdrant_client.models import Limit

def dump_points():
    client = get_qdrant_client()
    collection = "bibele_documents"
    res = client.scroll(
        collection_name=collection,
        limit=5,
        with_payload=True,
        with_vectors=False
    )
    print(f"COLLECTION: {collection}")
    for point in res[0]:
        print("-" * 30)
        print(f"ID: {point.id}")
        print(f"METADATA: {point.payload}")
        # print(f"TEXT PREVIEW: {point.payload.get('text', '')[:100]}...")

if __name__ == "__main__":
    dump_points()
