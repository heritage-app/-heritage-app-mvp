import asyncio
from app.rag.vector_store import get_qdrant_client
from qdrant_client import models
from app.rag.constants import COLLECTION_NAME

async def inspect_raw_data():
    client = get_qdrant_client()
    
    # Just scroll everything to see what metadata we have
    search_result = client.scroll(
        collection_name=COLLECTION_NAME,
        limit=20,
        with_payload=True
    )
    
    points, _ = search_result
    print(f"Found {len(points)} points.")
    
    for i, point in enumerate(points):
        print(f"\n--- Point {i+1} (ID: {point.id}) ---")
        # In LlamaIndex + Qdrant, payload often contains 'extra_info' or 'metadata'
        payload = point.payload
        print(f"Payload Keys: {list(payload.keys())}")
        
        # Look for typical LlamaIndex metadata locations
        metadata = payload.get('metadata') or payload.get('_node_content', {}).get('metadata', {})
        print(f"Metadata: {metadata}")
        
        text = payload.get('text', '')[:100]
        print(f"Text Snippet: {text}...")

if __name__ == "__main__":
    asyncio.run(inspect_raw_data())
