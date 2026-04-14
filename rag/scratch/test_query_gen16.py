
import asyncio
import sys
import os

# Add the project root to sys.path
sys.path.append(os.path.join(os.getcwd(), 'rag'))

from app.rag.service import ask

async def test_query():
    query = "list all the verses in genesis 16 only the verse numbers"
    user_id = "test_user"
    conversation_id = None
    
    print(f"Running query: {query}")
    
    response = ""
    async for chunk in ask(query, conversation_id, user_id, stream=False):
        response += chunk
        
    print("\n--- RESPONSE ---")
    print(response)
    print("--- END RESPONSE ---")

if __name__ == "__main__":
    asyncio.run(test_query())
