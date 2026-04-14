import asyncio
import os
import sys

# Add the project root to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.service import ask

async def test_diagnostic():
    query = "Hello"
    print(f"--- DIAGNOSTIC: TESTING GEMINI 1.5 FLASH ---")
    try:
        async for chunk in ask(query, conversation_id=None, user_id="diag", model="gemini-1.5-flash"):
            print(chunk, end="", flush=True)
        print("\n✅ 1.5 Flash works!")
    except Exception as e:
        print(f"\n❌ 1.5 Flash failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_diagnostic())
