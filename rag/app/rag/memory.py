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


MEMORY_WINDOW_SIZE = 10  # Number of recent messages to keep in memory


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


async def summarize_conversation_messages(conversation_id: str) -> str | None:
    """
    Summarize conversation messages (1 sentence max).
    Uses LLM to generate summary and stores it in database.
    
    Args:
        conversation_id: Unique conversation identifier
        
    Returns:
        str | None: Generated summary text (1 sentence max)
    """
    # Get all messages
    all_messages = await get_messages(conversation_id)
    
    if not all_messages or len(all_messages) == 0:
        return None
    
    # Format messages for summarization
    conversation_text = "\n\n".join(
        f"{msg.get('role', 'user').capitalize()}: {msg.get('content', '')}"
        for msg in all_messages[-10:]  # Use last 10 messages for summary
    )
    
    # Create summarization prompt using latest LangChain syntax
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful assistant that summarizes conversations in one short sentence."),
        ("human", """Provide a ONE SENTENCE summary (maximum 1 sentence) of the following conversation.
Focus on the main message meaning and intent.

Conversation:
{conversation_text}

Summary (one sentence only):""")
    ])
    
    llm = get_llm(temperature=0.3, streaming=False)
    chain = prompt_template | llm
    
    summary_input = {
        "conversation_text": conversation_text
    }
    
    response = chain.invoke(summary_input)
    summary_text = response.content if hasattr(response, 'content') else str(response)
    
    # Clean up summary - ensure it's one sentence
    summary_text = summary_text.strip().strip('"').strip("'")
    # Remove multiple sentences if present (keep only first sentence)
    sentences = summary_text.split('. ')
    if len(sentences) > 1:
        summary_text = sentences[0] + '.'
    
    # Save summary to database
    if summary_text:
        await save_conversation_summary(conversation_id, summary_text)
    
    return summary_text


async def generate_conversation_title(conversation_id: str) -> str | None:
    """
    Generate a conversation title based on actual translation content.
    Title reflects language direction (Ga → English or English → Ga), the user's query, and the response given.
    
    Args:
        conversation_id: Unique conversation identifier
        
    Returns:
        str | None: Generated title (short and descriptive, reflecting translation context)
    """
    # Get recent messages for title generation (need both user query and assistant response)
    messages = await get_messages(conversation_id, limit=6)
    
    if not messages or len(messages) == 0:
        return None
    
    # Find first user message and first assistant response
    user_query = None
    assistant_response = None
    
    for msg in messages:
        role = msg.get('role', '')
        content = msg.get('content', '')
        
        if role == 'user' and user_query is None:
            user_query = content
        elif role == 'assistant' and assistant_response is None:
            assistant_response = content
        
        if user_query and assistant_response:
            break
    
    # If we don't have both, use what we have
    if not user_query:
        user_query = messages[0].get('content', '') if messages else ''
    if not assistant_response:
        assistant_response = messages[1].get('content', '') if len(messages) > 1 else ''
    
    # Create title generation prompt focused on translation content
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful assistant that generates short, descriptive titles for Ga ↔ English translation conversations. Titles must reflect the actual translation or explanation that occurred."),
        ("human", """Generate a SHORT, descriptive title (3-6 words) for this Ga ↔ English translation conversation.

The title MUST reflect:
- The language direction (Ga → English or English → Ga)
- What was actually translated or explained
- The type of content (greeting, phrase, word, expression, etc.)

Examples of good titles:
- "Ga Greeting Translation to English"
- "English to Ga Love Phrase Translation"
- "Meaning of Ga Expression Explained"
- "Ga Word Translation Request"

User Query:
{user_query}

Assistant Response:
{assistant_response}

Generate a title (3-6 words, descriptive of the actual translation/exchange):""")
    ])
    
    llm = get_llm(temperature=0.7, streaming=False)
    chain = prompt_template | llm
    
    title_input = {
        "user_query": user_query[:200],  # Limit length
        "assistant_response": assistant_response[:300]  # Limit length
    }
    response = chain.invoke(title_input)
    title_text = response.content if hasattr(response, 'content') else str(response)
    
    # Clean up title (remove quotes, extra whitespace)
    title_text = title_text.strip().strip('"').strip("'").strip()
    
    # Ensure title is reasonable length (3-8 words to allow for descriptive phrases)
    words = title_text.split()
    if len(words) > 8:
        title_text = ' '.join(words[:8])
    elif len(words) < 2 and len(words) > 0:
        # If only 1 word, try to make it more descriptive
        # But keep as is for now (might be acceptable)
        pass
    
    # Save title to database
    if title_text:
        await save_conversation_title(conversation_id, title_text)
    
    return title_text


async def get_conversation_context(conversation_id: str) -> dict[str, Any]:
    """
    Get full conversation context to enable AI memory across conversation turns.
    
    Uses the conversation_id to retrieve:
    - Conversation summary: 1-sentence summary of the entire conversation history
    - Memory window: Last 10 messages for immediate context
    - Title: Conversation title for reference
    
    This function enables the AI to remember previous conversations by looking up
    the conversation_id and retrieving the stored summary and recent messages.
    
    Args:
        conversation_id: Unique conversation identifier used to look up conversation history
        
    Returns:
        Dict containing:
            - summary: Conversation summary (1 sentence, if exists)
            - memory_window: List of recent messages (last 10)
            - title: Conversation title (if exists)
    """
    # Check if title exists, generate if not
    title = await get_conversation_title(conversation_id)
    if not title:
        # Generate title based on first messages
        title = await generate_conversation_title(conversation_id)
    
    # Get or generate summary (1 sentence max)
    summary = await get_conversation_summary(conversation_id)
    
    # Generate summary for all messages (1 sentence max)
    if not summary:
        summary = await summarize_conversation_messages(conversation_id)
    
    # Get memory window
    memory_window = await get_memory_window(conversation_id)
    
    return {
        "summary": summary,
        "memory_window": memory_window,
        "title": title
    }
