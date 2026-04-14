import asyncio
import os
from app.rag.service import ask

async def main():
    # Mocking standard environment for local test
    query = "Genesis 6:8"
    user_id = "test-user"
    
    print("--- STARTING RAG QUERY ---")
    async for token in ask(
        query=query,
        conversation_id=None,
        user_id=user_id,
        stream=True,
        model="models/gemini-3.1-flash-lite-preview"
    ):
        pass # The tokens are yielded, but we want to see the PRINT statements from service.py
    print("--- QUERY FINISHED ---")

if __name__ == "__main__":
    os.environ["PYTHONPATH"] = "."
    asyncio.run(main())
