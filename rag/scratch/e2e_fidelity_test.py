import requests
import json
import uuid

def test_query(query):
    print(f"\nQUERY: {query}")
    print("-" * 40)
    
    url = "http://127.0.0.1:8080/api/v1/chat/new"
    headers = {
        "X-Anonymous-ID": str(uuid.uuid4()),
        "Content-Type": "application/json"
    }
    
    payload = {
        "query": query,
        "model": "models/gemini-3.1-flash-lite-preview"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, params={"stream": False}, timeout=30)
        
        if response.status_code != 200:
            print(f"Error ({response.status_code}): {response.text}")
            return None
            
        data = response.json()
        full_text = data.get("response", "")
        print(full_text)
        print("\n" + "-" * 40)
        return full_text
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    print("STARTING CORE RULES VALIDATION TEST...")
    
    # 1. Exact Match (Genesis 1:7)
    print("\n[RULE 7] EXACT MATCH (Genesis 1:7)")
    test_query("Genesis 1:7")

    # 2. Reference Mismatch (Genesis 1:1 vs retrieved Genesis 50:1)
    # This simulates Rule 6/Validation rejection
    print("\n[RULE 6] REFERENCE MISMATCH (Genesis 1:1 vs retrieved 50:1)")
    # Since I can't easily force a mismatch in a real retrieval without custom data,
    # I'll rely on the specific rejection message if it occurs.
    test_query("Genesis 1:1")

    # 3. Exact Match (Genesis 50:1) - Test Traditional Citation spelling
    print("\n[RULE 7] TRADITIONAL CITATION (Genesis 50:1)")
    test_query("Genesis 50:1")
    
    # 4. Incomplete Reference
    print("\n[RULE 8] INCOMPLETE REFERENCE (Kuku ni ji ekome)")
    test_query("Kuku ni ji ekome")
    
    # 5. Singular vs Plural (Rule 9)
    print("\n[RULE 9] SINGULAR vs PLURAL (A verse about love)")
    test_query("Give me a verse about love")
    
    print("\n[RULE 9] PLURAL (Verses about creation)")
    test_query("Give me verses about creation")
    
    # 6. Semantic Search (Rule 5)
    print("\n[RULE 5] SEMANTIC SEARCH (Where did Joseph weep?)")
    test_query("Show me where Joseph wept over his father")
