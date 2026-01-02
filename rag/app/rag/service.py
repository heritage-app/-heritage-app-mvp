"""
RAG orchestration service module.
Combines retrieval, memory, and LLM reasoning.
"""

from collections.abc import AsyncGenerator
from typing import Any
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from app.rag.llm import get_llm
from app.rag.retriever import retrieve_context, format_retrieved_context
from app.rag.memory import (
    get_conversation_context,
    summarize_conversation_messages,
    generate_conversation_title
)
from app.storage.supabase import save_message


async def ask(
    query: str,
    conversation_id: str | None,
    top_k: int = 5,
    stream: bool = True,
    skip_user_message: bool = False
) -> AsyncGenerator[str, None]:
    """
    Process a user query through the RAG pipeline.
    conversation_id is generated when saving the first message if not provided.
    
    Args:
        query: User query string
        conversation_id: Unique conversation identifier (generated if None)
        top_k: Number of context chunks to retrieve
        stream: Whether to stream the response
        skip_user_message: If True, don't save user message (already saved)
        
    Yields:
        str: Response tokens (if streaming) or full response
    """
    # Save user message (this will generate conversation_id if None)
    if not skip_user_message:
        saved_message = await save_message(conversation_id, "user", query)
        # Get the conversation_id from the saved message (generated if it was None)
        conversation_id = saved_message.get("conversation_id")
    
    # Get conversation context to remember previous conversation
    # This retrieves:
    # - Conversation summary: 1-sentence summary of the entire conversation history
    # - Memory window: Last 10 messages for immediate context
    # The conversation_id is used to look up this context from the database
    context = await get_conversation_context(conversation_id)
    summary = context.get("summary")
    memory_window = context.get("memory_window", [])
    
    # Retrieve relevant context chunks with retry logic
    retrieved_nodes = retrieve_context(query, top_k=top_k)
    context_text = format_retrieved_context(retrieved_nodes)
    has_indexed_context = bool(retrieved_nodes) and context_text.strip()
    
    # Build prompt with context using latest LangChain syntax
    system_prompt = """You are a Ga ↔ English language translation and interpretation assistant.
Your primary focus is translating between Ga and English, explaining meanings, usage, tone, and cultural context.

CORE TRANSLATION SCOPE:
- Translate Ga → English
- Translate English → Ga
- Explain meanings, usage, tone, and cultural context
- All responses should remain within this translation context

GREETING BEHAVIOR:
If the user greets without a question (e.g., "hello", "hi", "greetings"):
- Respond with both English and Ga versions using this format:
  ENG : [English greeting and introduction]
  GA : [Ga greeting and introduction]
- Use appropriate Ga greetings (hɛloo, Mi nŋabo, Ojekoo, etc.)
- Be friendly, respectful, and patient

KNOWLEDGE RETRIEVAL & FALLBACK LOGIC:

1. PRIMARY SOURCE: Use indexed documents as the first source of truth.
   - When indexed context is provided, prioritize information from those documents
   - Use retrieved document content for translations and explanations
   - Base responses on document content when available

2. GRACEFUL FALLBACK (When indexed documents don't provide sufficient information):
   - If no relevant indexed content is found, respond with:
     "I couldn't find this in my indexed materials, but I can still help based on general language knowledge."
   - Then proceed to answer using general linguistic and contextual understanding
   - Clearly avoid hallucinating document-specific facts
   - Focus on translation and language explanation using general knowledge

3. TRANSLATION APPROACH:
   - Automatically detect input language (English or Ga)
   - Infer intent from the user's question and detected languages
   - Use natural language understanding to bridge gaps
   - Provide clear, accurate translations
   - Explain cultural context and usage when relevant
   - Be helpful and flexible, prioritizing usefulness

TONE & BEHAVIOR:
- Be clear, patient, and helpful
- Avoid rigid "not found in documents" responses
- Prioritize usefulness over strict document matching
- Feel intelligent, flexible, and focused on Ga ↔ English translation
- Always provide value to the user, even when documents are incomplete

IMPORTANT:
- When indexed context is provided, use it as the primary source
- When indexed context is limited or unavailable, use general linguistic knowledge gracefully
- Never hallucinate document-specific facts that aren't in the retrieved context
- Focus on being helpful with translation and language explanation"""

    prompt_parts: list[tuple[str, str] | MessagesPlaceholder] = [("system", system_prompt)]
    
    # Add conversation summary to help AI remember what was discussed previously
    # The summary provides high-level context about the entire conversation history
    if summary:
        prompt_parts.append(("system", f"Conversation Summary:\n{summary}\n"))
    
    # Add retrieved context (only if we have meaningful results)
    if has_indexed_context:
        prompt_parts.append(("system", f"Retrieved Context from Indexed Documents:\n{context_text}\n"))
    else:
        # Inform the model that no indexed context was found (it will use graceful fallback)
        prompt_parts.append(("system", "Note: No relevant indexed document content was found for this query. Use general linguistic knowledge to provide a helpful translation or explanation."))
    
    # Add memory window (up to last 10 messages) to provide immediate conversation context
    # If there are fewer than 10 messages, all available messages are included
    # This allows the AI to remember recent exchanges and maintain conversation continuity
    if memory_window:
        prompt_parts.append(MessagesPlaceholder(variable_name="chat_history"))
    
    # Add current query
    prompt_parts.append(("human", "{question}"))
    
    prompt_template = ChatPromptTemplate.from_messages(prompt_parts)
    
    # Prepare input with conversation history for context
    prompt_input: dict[str, Any] = {"question": query}
    if memory_window:
        prompt_input["chat_history"] = memory_window  # Last 10 messages for conversation continuity
    
    # Get LLM
    llm = get_llm(temperature=0.7, streaming=stream)
    
    # Create chain using latest LangChain syntax
    chain = prompt_template | llm
    
    # Generate response
    if stream:
        full_response = ""
        async for chunk in chain.astream(prompt_input):
            token = chunk.content if hasattr(chunk, 'content') else str(chunk)
            full_response += token
            yield token
        
        # Save assistant response
        await save_message(conversation_id, "assistant", full_response)
        
        # Generate/update summary and title after each interaction
        await summarize_conversation_messages(conversation_id)
        await generate_conversation_title(conversation_id)
    else:
        response = chain.invoke(prompt_input)
        response_text = response.content if hasattr(response, 'content') else str(response)
        
        # Save assistant response
        await save_message(conversation_id, "assistant", response_text)
        
        # Generate/update summary and title after each interaction
        await summarize_conversation_messages(conversation_id)
        await generate_conversation_title(conversation_id)
        
        yield response_text
