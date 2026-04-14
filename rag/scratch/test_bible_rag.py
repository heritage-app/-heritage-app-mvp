import asyncio
import os
import sys

# Add the project root to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.retriever import retrieve_context
from app.rag.service import ask

async def test_bible_retrieval():
    query = "Quote 1 Corinthians 13:13 in Ga"
    print(f"--- TESTING BIBLE RETRIEVAL FOR: '{query}' ---")
    
    # 1. Test Raw Retrieval
    nodes = retrieve_context(query, top_k=5)
    if not nodes:
        print("❌ No documents retrieved for Bible query.")
    else:
        print(f"✅ Retrieved {len(nodes)} nodes.")
        for i, node in enumerate(nodes):
            metadata = node.node.metadata
            file_name = metadata.get('file_name') or metadata.get('filename') or "unknown"
            print(f"[Node {i+1}] Source: {file_name} | Score: {node.score:.4f}")
            print(f"Snippet: {node.node.get_content()[:150]}...")

    # 2. Test Full Pipeline
    print("\n--- TESTING FULL PIPELINE OUTPUT ---")
    response_text = ""
    async for chunk in ask(query, conversation_id=None, user_id="bible-test", stream=True):
        response_text += chunk
        print(chunk, end="", flush=True)
    print("\n")

if __name__ == "__main__":
    asyncio.run(test_bible_retrieval())
