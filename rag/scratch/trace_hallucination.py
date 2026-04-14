from app.rag.retriever import retrieve_context

def trace_hallucination():
    wrong_text = "Nɛkɛ ji Adam nitsumɔi a-wolo lɛ"
    print(f"Searching for source of: {wrong_text}")
    
    nodes = retrieve_context(wrong_text, top_k=5)
    for i, n in enumerate(nodes):
        filename = n.node.metadata.get('filename', 'unknown')
        score = n.score
        content = n.node.get_content()
        print(f"\n[{i}] SCORE: {score:.4f} | SOURCE: {filename}")
        print(f"CONTENT: {content[:300]}...")

if __name__ == "__main__":
    trace_hallucination()
