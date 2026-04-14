import sys
import os
# Add the current directory to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.retriever import retrieve_context
from app.rag.constants import COLLECTION_MAP

print("--- Testing General Retrieval (Heritage + Stories) ---")
# Test queries that might match those 9 heritage docs
queries = [
    "Ga festivals",
    "cultural traditions",
    "homowo",
    "history"
]

for query in queries:
    print(f"\nQUERY: {query}")
    nodes = retrieve_context(
        query, 
        top_k=5, 
        allowed_collections=["heritage_documents", "stories_documents"]
    )
    print(f"FOUND: {len(nodes)} nodes")
    for i, node in enumerate(nodes):
        meta = node.metadata
        print(f"  [{i+1}] Collection: {meta.get('collection_name', 'unknown')}")
        print(f"      Text Snip: {node.text[:100]}...")
