import asyncio
from app.rag.service import ask
from dotenv import load_dotenv

load_dotenv()

async def main():
    print("--- TESTING GENERAL SEARCH (Numerical Formula Content) ---")
    query = "Tell me about the Universal Ga Numerical Formula"
    
    # We use stream=False to simplify the print, but ask is a generator
    print(f"Query: {query}")
    print("Response: ", end="", flush=True)
    
    async for chunk in ask(
        query=query, 
        conversation_id="test-sync-verify", 
        user_id="system", 
        stream=False, 
        mode="general"
    ):
        print(chunk, end="", flush=True)
    print("\n" + "-"*50)

if __name__ == "__main__":
    asyncio.run(main())
