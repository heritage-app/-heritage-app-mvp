from app.rag.vector_store import get_qdrant_client
import json

def inspect_payload():
    client = get_qdrant_client()
    response = client.scroll(
        collection_name="bibele_documents",
        limit=1,
        with_payload=True
    )
    points = response[0]
    if not points:
        print("Empty collection.")
        return
    
    print(f"Payload keys: {list(points[0].payload.keys())}")
    print(f"Full Payload: {json.dumps(points[0].payload, indent=2)}")

if __name__ == "__main__":
    inspect_payload()
