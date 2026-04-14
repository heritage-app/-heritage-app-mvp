import asyncio
from app.rag.service import ask

async def test_discovery():
    queries = [
        "list the chapters in genesis",
        "how many chapters does genesis have",
        "list the verses in chapter 5"
    ]
    
    user_id = "test-user-123"
    
    for q in queries:
        print(f"\nQUERY: {q}")
        print("-" * 40)
        async for chunk in ask(q, conversation_id=None, user_id=user_id, stream=False):
            print(chunk, end="", flush=True)
        print("\n" + "-" * 40)

if __name__ == "__main__":
    asyncio.run(test_discovery())
