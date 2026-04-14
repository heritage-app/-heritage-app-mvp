from app.rag.retriever import retrieve_context
from app.rag.validator import is_formattable_bible_record
from llama_index.core.vector_stores.types import MetadataFilters, MetadataFilter

def debug_query():
    print("--- TESTING Genesis 47:29 ---")
    
    query = "Genesis 47:29"
    filter_list = [
        MetadataFilter(key="category", value="bible"),
        MetadataFilter(key="book", value="Genesis"),
        MetadataFilter(key="chapter_num", value=47),
        MetadataFilter(key="verse_num", value=29)
    ]
    bible_filters = MetadataFilters(filters=filter_list)
    
    nodes = retrieve_context(query, top_k=5, filters=bible_filters)
    
    if not nodes:
        print("retrieve_context() returned empty list for Genesis 47:29 target!")
        return

    print(f"Retrieved {len(nodes)} nodes.")
    for i, n in enumerate(nodes):
        meta = n.node.metadata if hasattr(n.node, 'metadata') else {}
        print(f"\n--- Node {i} ---")
        print(f"Book: '{meta.get('book')}'")
        print(f"Chapter: '{meta.get('chapter_num')}'")
        print(f"Verse: '{meta.get('verse_num')}'")
        print(f"Ga excerpt: '{meta.get('ga', '')[:100]}'...")
        print(f"En excerpt: '{meta.get('en', '')[:100]}'...")
        print(f"is_formattable_bible_record: {is_formattable_bible_record(meta)}")
        
if __name__ == "__main__":
    debug_query()
