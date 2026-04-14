import requests
import sys
import time

BASE_URL = "http://127.0.0.1:8080"
API_V1 = f"{BASE_URL}/api/v1"

def test_upload_and_index():
    print("--- Testing Document Upload & Indexing Pipeline ---")
    
    # 1. Create a dummy text file
    dummy_text = "Nii Obodai says that the heritage of the Ga people is preserved through oral traditions, festivals like Homowo, and deep respect for the ancestors. This is a highly specific dummy document for testing."
    files = {
        'file': ('heritage_test.txt', dummy_text, 'text/plain')
    }
    data = {
        'metadata': '{"category": "test", "author": "QA Team"}'
    }
    
    print("Uploading document 'heritage_test.txt'...")
    response = requests.post(f"{API_V1}/upload", files=files, data=data)
    
    if response.status_code != 200:
        print(f"❌ Upload failed with status {response.status_code}")
        print(response.text)
        sys.exit(1)
        
    result = response.json()
    print(f"✅ Upload successful!")
    print(f"   Status: {result.get('status')}")
    print(f"   Message: {result.get('message')}")
    print(f"   URL: {result.get('file_url')}")
    
    # 2. Test chat to see if RAG retrieves it
    print("\nWaiting a few seconds for indexing to settle...")
    time.sleep(3)
    
    print("\nTesting RAG retrieval for the uploaded document...")
    payload = {"query": "How is the heritage of the Ga people preserved according to Nii Obodai in the test document?"}
    chat_resp = requests.post(f"{API_V1}/chat/new", json=payload)
    
    if chat_resp.status_code != 200:
        print(f"❌ Chat failed with status {chat_resp.status_code}")
        print(chat_resp.text)
        sys.exit(1)
        
    chat_result = chat_resp.json()
    print(f"✅ Chat successful! (ID: {chat_result.get('conversation_id')})")
    print(f"   Q: {payload['query']}")
    print(f"   A: {chat_result.get('response')}")
    
    if "Homowo" in chat_result.get('response', '') or "oral traditions" in chat_result.get('response', ''):
        print("\n✅ Verification PASSED: Qdrant and LlamaIndex successfully retrieved the newly uploaded document!")
    else:
        print("\n⚠️ Verification WARNING: Answer did not contain expected keywords. Indexing might be delayed or failed.")

if __name__ == "__main__":
    test_upload_and_index()
