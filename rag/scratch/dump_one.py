import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.vector_store import get_qdrant_client

def dump_one():
    client = get_qdrant_client()
    collection = "bibele_documents"
    res = client.scroll(
        collection_name=collection,
        limit=1,
        with_payload=True
    )
    print(f"COLLECTION: {collection}")
    if res[0]:
        print(f"PAYLOAD: {res[0][0].payload}")
    else:
        print("Empty collection!")

if __name__ == "__main__":
    dump_one()
