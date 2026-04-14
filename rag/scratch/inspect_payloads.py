from app.rag.vector_store import get_qdrant_client
from app.rag.constants import COLLECTION_NAME

def inspect_payloads():
    client = get_qdrant_client()
    print(f"Inspecting collection: {COLLECTION_NAME}")
    
    # Get 5 points to see their payloads
    points, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        limit=5,
        with_payload=True,
        with_vectors=False
    )
    
    if not points:
        print("Collection is empty!")
        return

    for i, p in enumerate(points):
        print(f"\nPoint {i}: {p.id}")
        print(f"Payload: {p.payload}")

if __name__ == "__main__":
    inspect_payloads()
