import asyncio
import os
import sys
from pathlib import Path

# Add app directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.rag.indexer import BibleRefiner, index_from_bytes

async def test_gen17():
    snippet = """Jɛnɛsis 17
Ketiafoo akɛ Kpãŋmɔ lɛ he okadi
1  Be ni Abram eye afii nyɔŋmai nɛɛhu kɛ nɛɛhu lɛ, Yehowa jie ehe kpo... 2Mikɛ mikpãŋmɔ lɛ baaŋmɛ...

Genesis 17
1And when Abram was ninety years old and nine... 2And I will make my covenant..."""

    print("--- Running BibleRefiner on Genesis 17 snippet ---")
    records = BibleRefiner.parse_unstructured(snippet, "genesis_17_web.txt")
    
    print(f"Extracted {len(records)} verses.")
    for r in records[:2]:
        print(f"\nVerse {r['verse_num']}:")
        print(f"  Ga Label: {r['ga_verse_label']}")
        print(f"  Trad Book: {r['traditional_book']}")
        print(f"  Ga: {r['ga'][:50]}...")
        print(f"  En: {r['en'][:50]}...")

    # Test the full integration (this will try to upload a sidecar if STORAGE is mocked/valid)
    # Since I'm in a local test, I might just check if it fails gracefully or if storage is active.
    # We will use a fake path to avoid actual indexing if needed, but here we just want to see the prints.
    print("\n--- Testing index_from_bytes integration ---")
    try:
        await index_from_bytes(snippet.encode('utf-8'), "genesis_17_web.txt")
    except Exception as e:
        print(f"Index check (expect storage/qdrant errors in local test): {e}")

if __name__ == "__main__":
    asyncio.run(test_gen17())
