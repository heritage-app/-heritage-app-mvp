import asyncio
from app.rag.retriever import retrieve_context
from llama_index.core.vector_stores.types import MetadataFilters, MetadataFilter

async def debug_match():
    # Attempt to retrieve without filters to see what the metadata actually looks like
    print("Testing unrestricted retrieve for Genesis 13:8...")
    nodes = await retrieve_context("Genesis 13:8", top_k=5)
    
    for i, n in enumerate(nodes):
        m = n.metadata
        print(f"\nNode {i}:")
        print(f"Book: '{m.get('book')}'")
        print(f"Chapter: '{m.get('chapter_num')}'")
        print(f"Verse: '{m.get('verse_num')}'")
        print(f"Verse Ref: '{m.get('verse_ref')}'")
        print(f"Source: '{m.get('source_name')}'")

if __name__ == "__main__":
    asyncio.run(debug_match())
