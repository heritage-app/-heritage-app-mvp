import requests
import sys
import time
from datetime import datetime

BASE_URL = "http://127.0.0.1:8080"
API_V1 = f"{BASE_URL}/api/v1"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_root():
    log("Testing Root Endpoint...")
    resp = requests.get(BASE_URL)
    assert resp.status_code == 200
    assert "Heritage RAG" in resp.json().get("message", "")
    log("✅ Root OK")

def test_health():
    log("Testing Health Endpoint...")
    resp = requests.get(f"{API_V1}/health")
    assert resp.status_code == 200
    assert resp.json().get("status") == "healthy"
    log("✅ Health OK")

def test_list_conversations():
    log("Testing List Conversations...")
    resp = requests.get(f"{API_V1}/conversations")
    assert resp.status_code == 200
    log(f"✅ Conversations OK (Found {len(resp.json().get('conversations', []))})")

def test_chat_new():
    log("Testing New Chat Flow...")
    payload = {"query": "Tell me about the importance of heritage."}
    resp = requests.post(f"{API_V1}/chat/new", json=payload)
    
    if resp.status_code != 200:
        log(f"❌ Chat Failed: {resp.text}")
        return None
        
    data = resp.json()
    assert "conversation_id" in data
    assert "response" in data
    log(f"✅ Chat OK (ID: {data['conversation_id'][:8]}...)")
    log(f"Response Preview: {data['response'][:100]}...")
    return data['conversation_id']

def run_smoke_test():
    log("--- Starting Heritage RAG Smoke Test ---")
    try:
        test_root()
        test_health()
        test_list_conversations()
        conv_id = test_chat_new()
        
        if conv_id:
            log("--- Smoke Test Passed Successfully ---")
        else:
            log("--- Smoke Test Completed with Warnings ---")
            sys.exit(1)
            
    except Exception as e:
        log(f"💥 Smoke Test Failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    run_smoke_test()
