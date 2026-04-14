import asyncio
import os
import sys

# Add the project root to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.retriever import retrieve_context

async def check_genesis_1_1():
    query = "Shishijee mli Nyɔmɔ bɔ ŋwɛi kɛ shikpɔŋ"
    print(f"--- TESTING GENESIS 1:1 RETRIEVAL ---")
    
    nodes = retrieve_context(query, top_k=3)
    if not nodes:
        print("❌ No results.")
    else:
        for i, node in enumerate(nodes):
            metadata = node.node.metadata
            file_name = metadata.get('file_name') or metadata.get('filename') or "unknown"
            print(f"[Node {i+1}] Source: {file_name} | Score: {node.score:.4f}")
            print(f"Snippet: {node.node.get_content()[:200]}...")

if __name__ == "__main__":
    asyncio.run(check_genesis_1_1())
