from typing import List, Dict, Any, Optional
from app.rag.vector_store import get_qdrant_client
from app.rag.constants import COLLECTION_MAP
from qdrant_client import models

def list_chapters(book: str) -> Dict[int, str]:
    """Retrieves unique chapter numbers and their Ga titles for a given book."""
    client = get_qdrant_client()
    collection = COLLECTION_MAP["bible"]
    
    # Map of chapter_num -> chapter_title_ga
    chapters = {}
    offset = None
    while True:
        records, offset = client.scroll(
            collection_name=collection,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(key="category", match=models.MatchValue(value="bible")),
                    models.FieldCondition(key="book", match=models.MatchValue(value=book.capitalize()))
                ]
            ),
            limit=1000,
            with_payload=["chapter_num", "chapter_title_ga"],
            with_vectors=False,
            offset=offset
        )
        for r in records:
            p = r.payload
            if "chapter_num" in p:
                c_num = int(p["chapter_num"])
                if c_num not in chapters:
                    chapters[c_num] = p.get("chapter_title_ga", f"Yitso {c_num}")
        if offset is None:
            break
            
    # Return as sorted dict (by key)
    return dict(sorted(chapters.items()))

def list_verses(book: str, chapter_num: int) -> Dict[int, str]:
    """Retrieves unique verse numbers and their Ga labels for a specific chapter."""
    client = get_qdrant_client()
    collection = COLLECTION_MAP["bible"]
    
    # Map of verse_num -> ga_verse_label
    verses = {}
    offset = None
    while True:
        records, offset = client.scroll(
            collection_name=collection,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(key="category", match=models.MatchValue(value="bible")),
                    models.FieldCondition(key="book", match=models.MatchValue(value=book.capitalize())),
                    models.FieldCondition(key="chapter_num", match=models.MatchValue(value=chapter_num))
                ]
            ),
            limit=1000,
            with_payload=["verse_num", "ga_verse_label"],
            with_vectors=False,
            offset=offset
        )
        for r in records:
            p = r.payload
            if "verse_num" in p:
                v_num = int(p["verse_num"])
                if v_num not in verses:
                    verses[v_num] = p.get("ga_verse_label", f"Kuku {v_num}")
        if offset is None:
            break
            
    # Return as sorted dict (by key)
    return dict(sorted(verses.items()))

def get_bible_stats(book: Optional[str] = None) -> Dict[str, Any]:
    """Returns general stats about the indexed Bible archive."""
    client = get_qdrant_client()
    collection = COLLECTION_MAP["bible"]
    
    # This is a bit expensive if the collection is huge, 
    # but for the current Bible scale it's fine.
    # In a production setting, we'd cache this or store a master manifest record.
    stats = {"total_verses": 0, "books": set(), "chapters": 0}
    
    # Simple count for the whole collection
    res = client.count(
        collection_name=collection,
        count_filter=models.Filter(
            must=[models.FieldCondition(key="category", match=models.MatchValue(value="bible"))]
        )
    )
    stats["total_verses"] = res.count
    
    # Get book list
    records, _ = client.scroll(
        collection_name=collection,
        limit=1000,
        scroll_filter=models.Filter(
            must=[models.FieldCondition(key="category", match=models.MatchValue(value="bible"))]
        ),
        with_payload=["book"],
        with_vectors=False
    )
    for r in records:
        if "book" in r.payload:
            stats["books"].add(r.payload["book"])
    
    stats["books"] = sorted(list(stats["books"]))
    return stats
