import asyncio
import os
import sys
from unittest.mock import MagicMock, patch, AsyncMock

# Add the project root to sys.path
sys.path.append(os.getcwd())

from app.rag.service import ask

async def test_genesis_quote():
    query = "Quote Genesis 1:1 for me accurately in Ga."
    print(f"User Query: {query}")
    print("-" * 50)

    # Mock context representing the new schema columns
    mock_context = """
[Source: [Genesis](BIBLE1_1_1.pdf) | Score: 0.999]
{
    "verse_id": "MOSE1_1_1",
    "eng_ref": "Genesis 1:1",
    "eng_text": "In the beginning God created the heaven and the earth.",
    "ga_book_title": "Mose klɛŋklɛŋ wolo",
    "ga_ch_title": "Yitso Ekome",
    "ga_v_heading": "Kuku ni ji ekome",
    "ga_text": "Shishijee mli lɛ Nyɔŋmɔ bɔ ŋwɛi kɛ shikpɔŋ lɛ."
}
"""

    # We patch retrieve_context and format_retrieved_context to provide our mock data
    with patch("app.rag.service.retrieve_context") as mock_retrieve:
        with patch("app.rag.service.format_retrieved_context") as mock_format:
            mock_retrieve.return_value = [MagicMock()] # Just need one node to trigger logic
            mock_format.return_value = mock_context
            
            # Run the ask service
            print("Response Response:")
            full_response = ""
            async for chunk in ask(
                query=query,
                conversation_id="test_conv",
                user_id="test_user",
                stream=True
            ):
                print(chunk, end="", flush=True)
                full_response += chunk
            print("\n" + "-" * 50)

if __name__ == "__main__":
    # We need to ensure we don't actually try to save to DB during the test
    # So we patch the repositories as well
    with patch("app.storage.providers.Repositories.messages", new_callable=AsyncMock) as mock_msg_repo:
        with patch("app.storage.providers.Repositories.chat", new_callable=AsyncMock) as mock_chat_repo:
            # Mock the repo instances
            mock_msg_repo.return_value.save_interaction = AsyncMock(return_value=None)
            mock_chat_repo.return_value.initialize_session = AsyncMock(return_value=None)
            mock_chat_repo.return_value.update_activity = AsyncMock(return_value=None)
            # Add initialize_session for get_conversation_context likelyhood
            mock_chat_repo.return_value.get_session = AsyncMock(return_value={"summary": "No previous conversation."})
            
            # Patch memory functions
            with patch("app.rag.service.get_conversation_context", new_callable=AsyncMock) as mock_get_context:
                mock_get_context.return_value = {"summary": "No previous conversation.", "memory_window": []}
                
                with patch("app.rag.service.summarize_conversation_messages", new_callable=AsyncMock) as mock_sum:
                    with patch("app.rag.service.generate_conversation_title", new_callable=AsyncMock) as mock_tit:
                        mock_sum.return_value = None
                        mock_tit.return_value = None
                        
                        asyncio.run(test_genesis_quote())
