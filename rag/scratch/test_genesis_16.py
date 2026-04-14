import asyncio
import sys
from pathlib import Path

# Add the project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.service import ask

async def test_genesis_16():
    query = "quote a verse in genesis 16"
    print(f"Testing Query: {query}")
    print("-" * 50)
    
    async for chunk in ask(
        query=query,
        conversation_id=None,
        user_id="test_user_id",
        stream=True
    ):
        print(chunk, end="", flush=True)
    print("\n" + "-" * 50)

if __name__ == "__main__":
    asyncio.run(test_genesis_16())
