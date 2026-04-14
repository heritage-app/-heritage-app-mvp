from app.rag.vector_store import get_qdrant_client
from app.rag.constants import COLLECTION_MAP
from qdrant_client import models

def test_discovery():
    client = get_qdrant_client()
    collection = COLLECTION_MAP["bible"]
    print(f"Checking collection: {collection}")
    
    # 1. Target: List unique chapters in Genesis
    print("Listing unique chapter_nums in Genesis...")
    chapters = set()
    offset = None
    while True:
        records, offset = client.scroll(
            collection_name=collection,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(key="category", match=models.MatchValue(value="bible")),
                    models.FieldCondition(key="book", match=models.MatchValue(value="Genesis"))
                ]
            ),
            limit=1000,
            with_payload=["chapter_num"],
            with_vectors=False,
            offset=offset
        )
        for r in records:
            if "chapter_num" in r.payload:
                chapters.add(int(r.payload["chapter_num"]))
        if offset is None:
            break
            
    sorted_chapters = sorted(list(chapters))
    print(f"Total Chapters: {len(sorted_chapters)}")
    print(f"Chapters: {sorted_chapters}")

if __name__ == "__main__":
    test_discovery()
