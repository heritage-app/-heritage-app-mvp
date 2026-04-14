from app.rag.vector_store import get_qdrant_client
from app.rag.embeddings import get_embeddings
from llama_index.core import VectorStoreIndex, QueryBundle
from app.rag.vector_store import get_vector_store
from app.rag.constants import COLLECTION_MAP
import json

def diagnose():
    query = "Genesis 6:8"
    print(f"DIAGNOSING RETRIEVAL FOR: {query}")
    print("-" * 50)
    
    embeddings = get_embeddings()
    
    # Check specifically in bibele_documents
    coll = "bibele_documents"
    print(f"Searching collection: {coll}")
    
    try:
        vector_store = get_vector_store(coll)
        index = VectorStoreIndex.from_vector_store(
            vector_store=vector_store,
            embed_model=embeddings
        )
        
        retriever = index.as_retriever(similarity_top_k=5)
        
        # 1. Search with Query Bundle
        print("\nTOP 5 RETRIEVED NODES:")
        nodes = retriever.retrieve(QueryBundle(query_str=query))
        
        for i, node in enumerate(nodes):
            print(f"\n[{i+1}] SCORE: {node.score:.4f}")
            print(f"METADATA: {node.node.metadata}")
            print(f"TEXT PREVIEW: {node.node.get_content()[:200]}...")
            
        # 2. Raw Scroll to see what's in the collection for 6:8
        print("\nRAW SCROLL FOR '6:8':")
        client = get_qdrant_client()
        points, _ = client.scroll(
            collection_name=coll,
            limit=10,
            with_payload=True
        )
        
        count = 0
        for p in points:
            text = p.payload.get("text", "")
            if "6:8" in text or "7:1" in text:
                print(f"Point ID: {p.id}")
                print(f"Text: {text}")
                print("-" * 20)
                count += 1
        
        if count == 0:
            print("No points found containing '6:8' or '7:1' in the scroll.")

    except Exception as e:
        print(f"Error during diagnosis: {e}")

if __name__ == "__main__":
    diagnose()
