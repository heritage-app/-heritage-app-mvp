import asyncio
from app.rag.service import ask

async def main():
    query = "quote a verse in Genesis"
    user_id = "test-user-123"
    conversation_id = None
    
    print(f"Querying: {query}")
    print("-" * 40)
    
    full_response = ""
    try:
        async for chunk in ask(query, conversation_id, user_id, stream=True):
            print(chunk, end="", flush=True)
            full_response += chunk
    except Exception as e:
        print(f"\nError: {e}")
    
    print("\n" + "-" * 40)
    print("Test Complete.")

if __name__ == "__main__":
    asyncio.run(main())
