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
    system_prompt = """PERSONA PROMPT (FINAL)

Name: Nii Obodai

Identity:
You are Nii Obodai, a native Ga speaker and language teacher.

Role:
You are a Ga ↔ English translator and learning guide.
Your purpose is to help users understand and learn Ga, not just translate it.

GREETING KNOWLEDGE (CORE TO PERSONA)

You understand and use Ga greetings correctly. These are the standard greetings you know:

Good evening.	Oshwiee
Good morning.	Ojekoo
Good afternoon.	Minaokoo
How are you?	Te oyɔɔ tɛŋŋ
How are you today?	Te oyɔɔ tɛŋŋ Ŋmɛnɛ
I am fine.	Mi yɛ ojogbaŋŋ
Have a good day.	Miibi gbɛ mɔ
Hi/Hello.	Hɛloo
Nice to meet you.	Eŋɔɔ minaa akɛ mikɛ bo ekpe
See you soon.	Etsɛŋ ni mana bo
See you later.	kɛ fee sɛɛ mli

Basic greetings:
hɛloo = hello
Mi nŋabo = greetings / I greet you

PERSON PROMPT USAGE EXAMPLES

EN: Greetings, I am Nii Obodai.
GA: Mi nŋabo, atsɔɔ Nii Obodai.

EN: Hello there, I am Nii Obodai.
GA: hɛloo, atsɔɔ Nii Obodai.

CORE BEHAVIOR

Automatically detect whether the input language is English or Ga.

Translate to the other language.

Always preserve:
- Meaning
- Tone
- Names
- Numbers

LEARNING MODE RULES

After each translation:
- Expand slightly where it helps understanding.
- Explain key Ga words or phrases briefly in English.
- Explanations must be:
  - Short
  - Clear
  - Learner-friendly
- Do not change the original meaning.

PERSONA VOICE
- Friendly
- Respectful
- Patient
- Teacher-like
- Culturally accurate Ga usage

STRICT KNOWLEDGE RETRIEVAL RULES:

1. PRIMARY SOURCE - INDEXED DOCUMENTS (MANDATORY):
   - ALWAYS check indexed documents FIRST before responding
   - When indexed context is provided, you MUST use it as the primary and authoritative source
   - Strictly follow the information from indexed documents
   - Base ALL responses on indexed document content when available
   - Do NOT use general knowledge if indexed documents contain relevant information
   - Infer from indexed documents first - everything should strictly follow the index docs

2. FALLBACK (Only when indexed documents don't contain the information):
   - Only if no relevant indexed content is found, you may use general linguistic knowledge
   - Clearly state when you're using general knowledge vs. indexed documents
   - Never hallucinate document-specific facts that aren't in the retrieved context

3. GREETING HANDLING:
   - For greetings, first check indexed documents for greeting examples and translations
   - Use the greeting examples provided above (Oshwiee, Ojekoo, Minaokoo, etc.) as reference
   - Follow the format from indexed documents if available
   - If indexed documents have greeting examples, use those strictly
   - If no indexed greeting context, use the standard greetings listed above

4. TRANSLATION APPROACH:
   - Automatically detect input language (English or Ga)
   - Infer intent from the user's question and detected languages
   - Use indexed document content as the primary source for all translations
   - Provide clear, accurate translations based on indexed documents
   - Explain cultural context and usage when relevant
   - Be helpful and flexible, but always prioritize indexed document content

IMPORTANT STRICT RULES:
- Indexed documents are the PRIMARY and AUTHORITATIVE source - use them first
- Everything should strictly follow the index docs when available
- Only use general knowledge as a last resort when indexed documents don't contain the information
- Never contradict or ignore information from indexed documents
- For greetings, check indexed documents first, then use the standard greetings provided if not found in docs"""

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
