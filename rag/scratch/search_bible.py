import asyncio
import os
import sys

# Add the project root to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.retriever import retrieve_context

async def search_ga_bible_phrases():
    # Searching for "faith, hope and love" in Ga
    phrases = [
        "hemɔkɛyeli hiɛnɔkamɔ suɔmɔ", # faith hope love
        "1 Korinto 13:13",
        "1 Korinto 13",
        "suɔmɔ ni fe fɛɛ", # love which is the greatest
    ]
    
    print("🚀 SEARCHING BIBLE FOR SPECIFIC PHRASES\n")
    
    for query in phrases:
        print("-" * 50)
        print(f"QUERY: {query}")
        nodes = retrieve_context(query, top_k=3)
        if not nodes:
            print("❌ No results.")
        else:
            for i, node in enumerate(nodes):
                metadata = node.node.metadata
                file_name = metadata.get('file_name') or metadata.get('filename') or "unknown"
                print(f"[Node {i+1}] Source: {file_name} | Score: {node.score:.4f}")
                print(f"Snippet: {node.node.get_content()[:200]}...")
        print("-" * 50 + "\n")

if __name__ == "__main__":
    asyncio.run(search_ga_bible_phrases())
