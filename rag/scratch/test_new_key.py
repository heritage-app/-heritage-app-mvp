import asyncio
import os
import sys

# Add the project root to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.service import ask

async def test_new_key_quota():
    models = ["gemini-2.0-flash", "gemini-1.5-flash-latest"]
    
    print("-" * 50)
    print(f"🚀 TESTING NEW KEY QUOTA")
    print("-" * 50)
    
    for model in models:
        print(f"\n[MODEL: {model}]")
        try:
            async for chunk in ask("Hello", conversation_id=None, user_id="quota-test", model=model):
                print(chunk, end="", flush=True)
            print(f"\n✅ {model} works!")
        except Exception as e:
            print(f"\n❌ {model} failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_new_key_quota())
