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
from app.rag.prompts import NII_OBODAI_PERSONA
from app.rag.constants import DEFAULT_TOP_K


async def ask(
    query: str,
    conversation_id: str | None,
    top_k: int = DEFAULT_TOP_K,
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
    context = await get_conversation_context(conversation_id)
    summary = context.get("summary", "No previous conversation.")
    memory_window = context.get("memory_window", [])
    
    # Retrieve relevant context chunks with retry logic
    retrieved_nodes = retrieve_context(query, top_k=top_k)
    context_text = format_retrieved_context(retrieved_nodes)
    has_indexed_context = bool(retrieved_nodes) and context_text.strip()
    
    # Build prompt using externalized persona
    prompt_parts: list[tuple[str, str] | MessagesPlaceholder] = [("system", NII_OBODAI_PERSONA)]
    
    # Add memory window if it exists
    if memory_window:
        prompt_parts.append(MessagesPlaceholder(variable_name="chat_history"))
    
    # Add current query
    prompt_parts.append(("human", "{question}"))
    
    prompt_template = ChatPromptTemplate.from_messages(prompt_parts)
    
    # Prepare input
    prompt_input: dict[str, Any] = {
        "question": query,
        "summary": summary,
        "context_text": context_text if has_indexed_context else "No relevant document context found."
    }
    
    if memory_window:
        # Convert memory window to list of (role, content) for MessagesPlaceholder
        formatted_history = []
        for msg in memory_window:
            role = "human" if msg.get("role") == "user" else "assistant"
            formatted_history.append((role, msg.get("content", "")))
        prompt_input["chat_history"] = formatted_history
    
    # Get LLM
    llm = get_llm(temperature=0.7, streaming=stream)
    chain = prompt_template | llm
    
    # Generate response
    full_response = ""
    if stream:
        async for chunk in chain.astream(prompt_input):
            token = chunk.content if hasattr(chunk, 'content') else str(chunk)
            full_response += token
            yield token
    else:
        response = await chain.ainvoke(prompt_input)
        full_response = response.content if hasattr(response, 'content') else str(response)
        yield full_response
        
    # Background tasks: Save response and update summary/title
    # Note: In a real production app, these might be better as background tasks
    # but we'll keep the original flow for consistency.
    await save_message(conversation_id, "assistant", full_response)
    await summarize_conversation_messages(conversation_id)
    await generate_conversation_title(conversation_id)
