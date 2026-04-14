import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.service import ask

async def test_v6_8():
    query = "quote genesis 6 : 8"
    print(f"TESTING QUERY: {query}")
    print("-" * 50)
    
    full_response = ""
    async for chunk in ask(query, conversation_id=None, user_id="test_user"):
        full_response += chunk
        print(chunk, end="", flush=True)
    
    print("\n" + "-" * 50)
    
    # Validation
    expected_ga = "ŋmɔdɔŋ" # User preferred
    # Or at least something that looks like the archive
    if "Shi Noa ná" in full_response or "Shi Yehowa na Noa" in full_response:
        print("RESULT: SUCCESS - Correct verse retrieved.")
    else:
        print("RESULT: FAILURE - Verse not found in response.")

if __name__ == "__main__":
    asyncio.run(test_v6_8())
