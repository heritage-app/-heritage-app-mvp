import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.service import ask

async def test_sourcing():
    print("Testing Sourcing Logic...")
    query = "What is Mose klɛŋklɛŋ wolo?"
    print(f"Query: {query}")
    
    full_response = ""
    async for chunk in ask(query, conversation_id=None, user_id="test_user", stream=True):
        full_response += chunk
        print(chunk, end="", flush=True)
    
    print("\n" + "="*50)
    print("Testing Numerical Engine...")
    query2 = "How do you say 28 in Ga?"
    print(f"Query: {query2}")
    
    full_response2 = ""
    async for chunk in ask(query2, conversation_id=None, user_id="test_user", stream=True):
        full_response2 += chunk
        print(chunk, end="", flush=True)
    print("\n" + "="*50)

if __name__ == "__main__":
    asyncio.run(test_sourcing())
