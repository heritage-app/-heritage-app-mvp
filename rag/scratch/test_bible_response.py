
import asyncio
import sys
import os

# Add the project root to sys.path
sys.path.append(os.getcwd())

from app.rag.service import ask

async def test_bible_query():
    query = "quote genesis 1:7"
    conversation_id = "test-conv-123"
    user_id = "test-user-123"
    
    print(f"Testing Query: {query}\n" + "="*50)
    
    full_response = ""
    async for chunk in ask(query, conversation_id, user_id=user_id, stream=True):
        full_response += chunk
        # print(chunk, end="", flush=True) # Silencing stream for cleaner output
    
    print("\nFINAL RESPONSE:")
    print("-" * 30)
    print(full_response)
    print("-" * 30)

if __name__ == "__main__":
    asyncio.run(test_bible_query())
