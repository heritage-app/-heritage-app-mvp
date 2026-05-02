"""
Test script for admin upload and delete endpoints.
Run with: python test_admin.py
"""
import requests
import io
import time
import sys
import os

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080/api/v1")

def login():
    """Login as admin to get cookies."""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": "admin@heritage.app", "password": "admin123"},
        cookies={}
    )
    if response.status_code == 200:
        print("✅ Login successful")
        return response.cookies
    else:
        print(f"❌ Login failed: {response.status_code} - {response.text}")
        sys.exit(1)

def test_stats(cookies):
    """Test admin stats endpoint."""
    print("\n📊 Testing /admin/stats...")
    response = requests.get(f"{BASE_URL}/admin/stats", cookies=cookies)
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Stats: {data}")
        return data
    else:
        print(f"❌ Stats failed: {response.status_code} - {response.text}")
        return None

def test_upload(cookies):
    """Test admin upload endpoint."""
    print("\n📤 Testing /admin/upload...")
    
    # Create a test file
    test_content = b"This is a test document for upload.\nLine 2.\nLine 3."
    files = {"file": ("test_admin_upload.txt", io.BytesIO(test_content), "text/plain")}
    
    try:
        response = requests.post(f"{BASE_URL}/admin/upload", files=files, cookies=cookies)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Upload: {data}")
            return data
        else:
            print(f"❌ Upload failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Upload error: {e}")
        return None

def test_list_documents(cookies):
    """Test admin documents list endpoint."""
    print("\n📄 Testing /admin/documents...")
    response = requests.get(f"{BASE_URL}/admin/documents?limit=5", cookies=cookies)
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Documents: {data}")
        return data.get("documents", [])
    else:
        print(f"❌ List failed: {response.status_code} - {response.text}")
        return []

def test_delete(cookies, doc_id):
    """Test admin delete endpoint."""
    print(f"\n🗑️ Testing /admin/documents/{doc_id}...")
    
    response = requests.delete(f"{BASE_URL}/admin/documents/{doc_id}", cookies=cookies)
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Delete: {data}")
        return True
    else:
        print(f"❌ Delete failed: {response.status_code} - {response.text}")
        return False

def test_refine_preview(cookies):
    """Test admin refine preview endpoint."""
    print("\n📖 Testing /admin/refine/preview...")
    
    test_content = b"""Genesis 1:1 In the beginning God created the heavens and the earth.
Genesis 1:2 And the earth was without form, and void; and darkness was upon the face of the deep.
Genesis 1:3 And God said, Let there be light: and there was light.
"""
    files = {"file": ("bible_test.txt", io.BytesIO(test_content), "text/plain")}
    
    try:
        response = requests.post(f"{BASE_URL}/admin/refine/preview", files=files, cookies=cookies)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Preview: Found {len(data.get('refined_records', []))} verses")
            return data
        else:
            print(f"❌ Preview failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Preview error: {e}")
        return None

def main():
    print("🧪 Admin API Test Suite")
    print("=" * 40)
    
    # Login first
    cookies = login()
    
    # Test stats (parallel queries)
    test_stats(cookies)
    
    # Test upload (non-blocking)
    upload_result = test_upload(cookies)
    
    # Wait a bit for background indexing
    time.sleep(2)
    
    # Test list documents
    docs = test_list_documents(cookies)
    
    # Test delete if we have documents
    if docs:
        test_delete(cookies, docs[0]["id"])
    
    # Test refine preview
    test_refine_preview(cookies)
    
    print("\n" + "=" * 40)
    print("✅ Test suite complete!")

if __name__ == "__main__":
    main()