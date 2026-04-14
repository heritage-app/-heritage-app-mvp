import asyncio
from app.rag.vector_store import get_qdrant_client
from qdrant_client import models
from app.rag.constants import COLLECTION_NAME

async def inspect_bible_data():
    client = get_qdrant_client()
    
    # Search for points that might be Bible verses
    search_result = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=models.Filter(
            should=[
                models.FieldCondition(key="category", match=models.MatchValue(value="bible")),
                models.FieldCondition(key="filename", match=models.MatchText(text="genesis")),
                models.FieldCondition(key="file_path", match=models.MatchText(text="genesis")),
                models.FieldCondition(key="filename", match=models.MatchText(text="BIBLE")),
            ]
        ),
        limit=10,
        with_payload=True
    )
    
    points, _ = search_result
    print(f"Found {len(points)} matching points.")
    
    for i, point in enumerate(points):
        print(f"\n--- Point {i+1} (ID: {point.id}) ---")
        print(f"Metadata: {point.payload.get('metadata', point.payload)}")
        text = point.payload.get('text', '')[:200]
        print(f"Text Snippet: {text}...")

if __name__ == "__main__":
    asyncio.run(inspect_bible_data())
