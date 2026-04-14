import asyncio
import os
import sys

# Add the project root to sys.path to allow imports from 'app'
sys.path.append(os.getcwd())

from app.rag.service import ask

async def run_smoke_test():
    test_queries = [
        "Count from 1 to 10 in Ga",
        "Count from 1 to 20 in Ga"
    ]
    
    user_id = "test-user-smoke"
    print("🚀 STARTING SMOKE TEST FOR GA NUMERICAL RAG\n")
    
    for query in test_queries:
        print("-" * 50)
        print(f"QUERY: {query}")
        print("-" * 50)
        
        response_text = ""
        # We use stream=False for easier output capture in the console for this test
        async for chunk in ask(query, conversation_id=None, user_id=user_id, stream=True):
            response_text += chunk
            # Print chunks as they come for effect
            print(chunk, end="", flush=True)
        
        print("\n" + "-" * 50 + "\n")

if __name__ == "__main__":
    asyncio.run(run_smoke_test())
