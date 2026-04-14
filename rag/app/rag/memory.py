"""
Memory window and conversation summarization module.
Handles memory window (last N messages) and older message summarization.
Uses MongoDB repositories for persistence.
"""

from typing import List, Any
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from app.rag.llm import get_llm
from app.storage.providers import Repositories
from app.rag.constants import MEMORY_WINDOW_SIZE
from app.rag.prompts import SUMMARIZATION_PROMPT, TITLE_GENERATION_PROMPT


async def get_messages_helper(conversation_id: str, user_id: str = None, limit: int = MEMORY_WINDOW_SIZE) -> List[dict]:
    """
    Helper to get interactions from the repository and flatten them for memory/processing.
    """
    repo = await Repositories.messages()
    # Note: limit refers to "turns" now, so 5 turns = 10 messages
    interactions = await repo.get_by_conversation(conversation_id, user_id=user_id, limit=limit)
    
    flattened = []
    for turn in interactions:
        # Add User message
        flattened.append({
            "role": "user",
            "content": turn.get("query", ""),
            "created_at": turn.get("created_at")
        })
        # Add Assistant message
        if turn.get("response"):
            flattened.append({
                "role": "assistant",
                "content": turn.get("response", ""),
                "created_at": turn.get("created_at")
            })
            
    return flattened


async def get_memory_window(conversation_id: str, user_id: str = None, window_size: int = MEMORY_WINDOW_SIZE) -> List[BaseMessage]:
    """
    Get memory window (last N messages) for a conversation.
    """
    messages_data = await get_messages_helper(conversation_id, user_id=user_id, limit=window_size)
    
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
                langchain_messages.append(HumanMessage(content=content))
    
    return langchain_messages


import logging

logger = logging.getLogger(__name__)

async def summarize_conversation_messages(conversation_id: str, user_id: str = None, messages: List[dict] | None = None, model: str | None = None) -> str | None:
    """
    Summarize conversation messages (1 sentence max).
    Fail-silent to prevent network errors from crashing the main chat flow.
    """
    try:
        if messages is None:
            messages = await get_messages_helper(conversation_id, user_id=user_id, limit=10)
        
        if not messages:
            return None
            
        # Only summarize if there's enough history to warrant it (min 3 messages)
        if len(messages) < 3:
            return None
        
        conversation_text = "\n\n".join(
            f"{msg.get('role', 'user').capitalize()}: {msg.get('content', '')}"
            for msg in messages[-10:]
        )
        
        prompt_template = ChatPromptTemplate.from_template(SUMMARIZATION_PROMPT)
        llm = get_llm(temperature=0.1, streaming=False, model=model) # Lower temp for summaries
        chain = prompt_template | llm
        
        response = chain.invoke({
            "summary": "No existing summary.",
            "messages": conversation_text
        })
        
        # Handle both string and list content (multimodal)
        content = response.content if hasattr(response, 'content') else str(response)
        if isinstance(content, list):
            summary_text = "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
        else:
            summary_text = content
        
        # Basic check to avoid conversational summaries
        if any(greet in summary_text.lower() for greet in ["hello", "hi ", "how are you", "let's start"]):
            return None

        summary_text = summary_text.strip().strip('"').strip("'").split('. ')[0] + '.'
        
        if summary_text and summary_text != "Conversation started.":
            repo = await Repositories.chat()
            await repo.update_summary(conversation_id, summary_text)
        
        return summary_text
    except Exception as e:
        logger.error(f"Failed to summarize conversation {conversation_id}: {e}")
        return None


async def generate_conversation_title(conversation_id: str, user_id: str = None, messages: List[dict] | None = None, model: str | None = None) -> str | None:
    """
    Generate a conversation title based on content.
    Fail-silent logic for resiliency.
    """
    try:
        if messages is None:
            messages = await get_messages_helper(conversation_id, user_id=user_id, limit=6)
        
        if not messages:
            return None
        
        user_query = next((m.get('content') for m in messages if m.get('role') == 'user'), messages[0].get('content', ''))
        assistant_resp = next((m.get('content') for m in messages if m.get('role') == 'assistant'), "")

        prompt_template = ChatPromptTemplate.from_messages([
            ("system", "You generate short (3-6 words) descriptive titles for Ga Heritage conversations."),
            ("human", "User: {user_query}\nAssistant: {assistant_response}\n\nTitle:")
        ])
        
        llm = get_llm(temperature=0.7, streaming=False, model=model)
        chain = prompt_template | llm
        response = chain.invoke({"user_query": user_query[:200], "assistant_response": assistant_resp[:300]})
        
        # Handle both string and list content (multimodal)
        content = response.content if hasattr(response, 'content') else str(response)
        if isinstance(content, list):
            title_text = "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
        else:
            title_text = content
        title_text = title_text.strip().strip('"').strip("'").strip()
        
        if title_text:
            repo = await Repositories.chat()
            await repo.update_title(conversation_id, title_text)
        
        return title_text
    except Exception as e:
        logger.error(f"Failed to generate title for {conversation_id}: {e}")
        return None


async def get_conversation_context(conversation_id: str, user_id: str = None, model: str | None = None) -> dict[str, Any]:
    """
    Retrieve full conversation context (summary, title, messages) from MongoDB.
    """
    import asyncio
    
    # 1. Parallel fetch of session and messages
    chat_repo = await Repositories.chat()
    session_task = chat_repo.get_by_id_and_user(conversation_id, user_id)
    messages_task = get_messages_helper(conversation_id, user_id=user_id, limit=MEMORY_WINDOW_SIZE)
    
    session, messages_data = await asyncio.gather(session_task, messages_task)
    
    title = session.get("title") if session else None
    summary = session.get("summary") if session else None
    
    # 2. Generate missing components if we have messages
    if messages_data:
        if not title:
            title = await generate_conversation_title(conversation_id, user_id=user_id, messages=messages_data, model=model)
        
        # Only trigger dynamic summarization if we have a significant exchange
        if not summary and len(messages_data) >= 3:
            summary = await summarize_conversation_messages(conversation_id, user_id=user_id, messages=messages_data, model=model)
    
    # 3. Format messages for UI/Service
    memory_window = []
    for msg in messages_data:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        memory_window.append({"role": role, "content": content})
    
    return {
        "summary": summary,
        "memory_window": memory_window,
        "title": title or "New Conversation"
    }
