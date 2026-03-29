"""
Memory window and conversation summarization module.
Handles memory window (last N messages) and older message summarization.
"""

from typing import List, Any
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from app.rag.llm import get_llm
from app.storage.supabase import (
    get_messages, 
    save_conversation_summary, 
    get_conversation_summary,
    save_conversation_title,
    get_conversation_title
)
from app.rag.constants import MEMORY_WINDOW_SIZE
from app.rag.prompts import SUMMARIZATION_PROMPT, TITLE_GENERATION_PROMPT


async def get_memory_window(conversation_id: str, window_size: int = MEMORY_WINDOW_SIZE) -> List[BaseMessage]:
    """
    Get memory window (last N messages) for a conversation.
    
    Retrieves the most recent messages for a given conversation_id. The window_size
    is a maximum limit - if there are fewer messages than the limit, all available
    messages are returned. For example:
    - If there are 3 messages and window_size is 10: returns all 3 messages
    - If there are 15 messages and window_size is 10: returns the last 10 messages
    - If there are 0 messages: returns an empty list
    
    Args:
        conversation_id: Unique conversation identifier to look up messages
        window_size: Maximum number of recent messages to retrieve (default: 10)
        
    Returns:
        List[BaseMessage]: List of LangChain message objects. Returns all available
                          messages up to window_size limit, or empty list if none exist.
    """
    messages_data = await get_messages(conversation_id, limit=window_size)
    
    langchain_messages: List[BaseMessage] = []
    for msg in messages_data:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        
        match role:
            case "user":
                langchain_messages.append(HumanMessage(content=content))
            case "assistant":
                langchain_messages.append(AIMessage(content=content))
            case "system":
                langchain_messages.append(SystemMessage(content=content))
            case _:
                # Default to human message for unknown roles
                langchain_messages.append(HumanMessage(content=content))
    
    return langchain_messages


async def summarize_conversation_messages(conversation_id: str, messages: List[dict] | None = None) -> str | None:
    """
    Summarize conversation messages (1 sentence max).
    Args:
        conversation_id: Unique conversation identifier
        messages: Optional pre-fetched messages
    """
    if messages is None:
        messages = await get_messages(conversation_id, limit=10)
    
    if not messages:
        return None
    
    conversation_text = "\n\n".join(
        f"{msg.get('role', 'user').capitalize()}: {msg.get('content', '')}"
        for msg in messages[-10:]
    )
    
    # Note: We skip re-fetching existing summary to save a DB call, 
    # as the caller should handle it or we use a default.
    prompt_template = ChatPromptTemplate.from_template(SUMMARIZATION_PROMPT)
    llm = get_llm(temperature=0.3, streaming=False)
    chain = prompt_template | llm
    
    response = chain.invoke({
        "summary": "No existing summary.",
        "messages": conversation_text
    })
    summary_text = response.content if hasattr(response, 'content') else str(response)
    summary_text = summary_text.strip().strip('"').strip("'").split('. ')[0] + '.'
    
    if summary_text:
        await save_conversation_summary(conversation_id, summary_text)
    
    return summary_text


async def generate_conversation_title(conversation_id: str, messages: List[dict] | None = None) -> str | None:
    """
    Generate a conversation title based on translation content.
    """
    if messages is None:
        messages = await get_messages(conversation_id, limit=6)
    
    if not messages:
        return None
    
    user_query = next((m.get('content') for m in messages if m.get('role') == 'user'), messages[0].get('content', ''))
    assistant_resp = next((m.get('content') for m in messages if m.get('role') == 'assistant'), "")

    prompt_template = ChatPromptTemplate.from_messages([
        ("system", "You generate short (3-6 words) descriptive titles for Ga Heritage conversations."),
        ("human", "User: {user_query}\nAssistant: {assistant_response}\n\nTitle:")
    ])
    
    llm = get_llm(temperature=0.7, streaming=False)
    chain = prompt_template | llm
    response = chain.invoke({"user_query": user_query[:200], "assistant_response": assistant_resp[:300]})
    title_text = response.content if hasattr(response, 'content') else str(response)
    title_text = title_text.strip().strip('"').strip("'").strip()
    
    if title_text:
        await save_conversation_title(conversation_id, title_text)
    
    return title_text


async def get_conversation_context(conversation_id: str) -> dict[str, Any]:
    """
    Efficiently retrieve full conversation context in parallel.
    """
    import asyncio
    
    # 1. Parallel fetch of existing data
    title_task = get_conversation_title(conversation_id)
    summary_task = get_conversation_summary(conversation_id)
    messages_task = get_messages(conversation_id, limit=MEMORY_WINDOW_SIZE)
    
    title, summary, messages_data = await asyncio.gather(title_task, summary_task, messages_task)
    
    # 2. Generate missing components if we have messages
    if messages_data:
        if not title:
            title = await generate_conversation_title(conversation_id, messages_data)
        if not summary:
            summary = await summarize_conversation_messages(conversation_id, messages_data)
    
    # 3. Format messages for LangChain
    memory_window = []
    for msg in messages_data:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        memory_window.append({"role": role, "content": content})
    
    return {
        "summary": summary or "No previous conversation.",
        "memory_window": memory_window,
        "title": title or "New Conversation"
    }
