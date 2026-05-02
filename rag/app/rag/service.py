"""
RAG orchestration service module.
Combines retrieval, memory, and LLM reasoning.
Uses MongoDB repositories for persistence.
"""

import uuid
import logging
import asyncio
from collections.abc import AsyncGenerator
from typing import Any, Optional, List
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from app.rag.llm import get_llm
from app.rag.retriever import retrieve_context, format_retrieved_context
from app.rag.memory import (
    get_conversation_context,
    summarize_conversation_messages,
    generate_conversation_title
)
from app.storage.providers import Repositories
from app.rag.constants import DEFAULT_TOP_K
from app.core.config import settings
from app.core.resilience import instrument_time, retry_llm
from app.core.cache import cached_llm_response, generate_cache_key, llm_cache

logger = logging.getLogger(__name__)


@retry_llm
@instrument_time("LLM_Persona_Stream")
async def _stream_persona_response(
    query: str,
    grounded_answer: str,
    memory_window: list,
    model: str | None = None,
    stream: bool = True
) -> AsyncGenerator[str, None]:
    """Helper to stream the grounded answer through the Nii Obodai persona."""
    from app.rag.prompts import NII_OBODAI_PERSONA_PROMPT
    persona_template = ChatPromptTemplate.from_messages([
        ("system", NII_OBODAI_PERSONA_PROMPT),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{query}")
    ])
    
    persona_llm = get_llm(temperature=0.7, streaming=stream, model=model)
    persona_chain = persona_template | persona_llm
    
    async for chunk in persona_chain.astream({
        "query": query,
        "history": memory_window,
        "context": "", # Context is already inside grounded_answer for Persona
        "grounded_answer": grounded_answer
    }):
        content = chunk.content if hasattr(chunk, 'content') else str(chunk)
        if isinstance(content, list):
            token = "".join([part.get("text", "") if isinstance(part, dict) else str(part) for part in content])
        else:
            token = content
        
        # Strip ghost headers from start of tokens
        if token:
            for ghost in ["Linguistic Engine", "inguistic Engine", "Engine"]:
                if token.startswith(ghost):
                    token = token[len(ghost):].strip()
            yield token


@instrument_time("RAG_Bible_Engine")
async def ask_bible(
    query: str,
    conversation_id: str,
    user_id: str,
    memory_window: list,
    top_k: int = DEFAULT_TOP_K,
    stream: bool = True,
    model: str | None = None
) -> AsyncGenerator[str, None]:
    """Dedicated Bible RAG engine with strict archival fidelity."""
    from llama_index.core.vector_stores import MetadataFilter, MetadataFilters
    import re
    from app.rag.utils import resolve_ga_citation, num_to_ga
    from app.rag.validator import is_formattable_bible_record, format_bible_quote
    from app.rag.prompts import STRICT_GUARDRAIL_PROMPT

    q_low = query.lower()
    
    # 1. Determine top_k based on intent
    is_singular = any(p in q_low for p in ["a verse", "any verse", "quote a verse"])
    is_plural = any(w in q_low for w in ["verses", "multiple", "list", "all", "chapters"])
    effective_top_k = 1 if is_singular else (25 if is_plural else top_k)

    # 2. Bible Intent Parsing
    incomplete_match = re.search(r'^\s*(?:kuku\s+ni\s+ji|verse|chapter|yitso)\s+\d+\s*$', q_low)
    is_incomplete = incomplete_match and not any(b in q_low for b in ["genesis", "exodus", "leviticus", "numbers", "deuteronomy", "mose"])
    
    ref_match = re.search(r'(genesis|exodus|leviticus|numbers|deuteronomy|mose)\s+(\d+)(?:[\s:]+(\d+))?', q_low)
    ga_ref = resolve_ga_citation(q_low)
    
    is_specific = (ref_match or ga_ref["chapter"]) and not is_incomplete
    requested_book, requested_ch, requested_v = None, None, None
    raw_book = None
    
    if is_specific:
        if ref_match:
            raw_book = ref_match.group(1).lower()
            requested_ch = int(ref_match.group(2))
            requested_v = int(ref_match.group(3)) if ref_match.group(3) else None
        if ga_ref["chapter"]:
            requested_ch = ga_ref["chapter"]
            if ga_ref["verse"]: requested_v = ga_ref["verse"]
            if not ref_match:
                for b in ["genesis", "exodus", "leviticus", "numbers", "deuteronomy", "mose"]:
                    if b in q_low: raw_book = b; break
        
        book_map = {
            "genesis": "Genesis", "mose": "Genesis", 
            "exodus": "Exodus", "leviticus": "Leviticus", 
            "numbers": "Numbers", "deuteronomy": "Deuteronomy"
        }
        requested_book = book_map.get(raw_book, raw_book.capitalize() if raw_book else "Genesis")

    # 3. Structural Discovery
    is_chapter_list = any(w in q_low for w in ["chapters in", "list chapters", "available chapters"])
    is_verse_list = (any(w in q_low for w in ["verses in", "list verses", "available verses"]) or (is_specific and requested_ch and not requested_v))
    is_counting = any(w in q_low for w in ["how many", "count"])
    is_structural = (is_chapter_list or is_verse_list or is_counting) and (requested_book or "genesis" in q_low)

    if is_structural:
        from app.rag.discovery import list_chapters, list_verses
        book_to_use = requested_book or "Genesis"
        if is_chapter_list:
            res_map = list_chapters(book_to_use)
            ga_name = f"{book_to_use} wolo"
            ga_count = num_to_ga(len(res_map))
            list_str = "\n".join([f"- {n} ({t})" for n, t in res_map.items()])
            grounded = f"Ye {ga_name} archive lɛ mli lɛ, wɔyɛ yitsoi {ga_count} ({len(res_map)} chapters):\n\n{list_str}"
        elif is_verse_list:
            ch_to_use = requested_ch or 1
            res_map = list_verses(book_to_use, ch_to_use)
            ga_ch = num_to_ga(ch_to_use)
            ga_count = num_to_ga(len(res_map))
            list_str = "\n".join([f"- {n} ({l})" for n, l in res_map.items()])
            grounded = f"Ye {book_to_use} Yitso {ga_ch} lɛ mli lɛ, wɔyɛ kukuji {ga_count} ({len(res_map)} verses):\n\n{list_str}"
        elif is_counting:
            count = len(list_verses(book_to_use, requested_ch) if requested_ch else list_chapters(book_to_use))
            grounded = f"Wɔyɛ {num_to_ga(count)} ({count}) yɛ archive lɛ mli."
        else:
            grounded = "I could not find the information you are looking for in the structure of the Bible."
        
        async for t in _stream_persona_response(query, grounded, memory_window, model, stream): yield t
        return

    # 4. Retrieval with Strict Collection Filter
    filters = None
    if is_specific:
        filter_list = [
            MetadataFilter(key="category", value="bible"), 
            MetadataFilter(key="book", value=requested_book), 
            MetadataFilter(key="chapter_num", value=requested_ch)
        ]
        if requested_v: filter_list.append(MetadataFilter(key="verse_num", value=requested_v))
        filters = MetadataFilters(filters=filter_list)
    
    nodes = retrieve_context(query, top_k=effective_top_k, filters=filters, allowed_collections=["bibele_documents"])
    
    # 5. Validation & Grounding
    validation_failed = False
    matched_meta = None
    if is_specific and nodes:
        any_exact = False
        for n in nodes:
            m = n.metadata
            b_match = str(m.get("book","")).lower() == requested_book.lower()
            c_match = int(m.get("chapter_num", 0)) == requested_ch
            v_match = int(m.get("verse_num", 0)) == requested_v if requested_v else True
            if b_match and c_match and v_match:
                any_exact = True; matched_meta = m; break
        if not any_exact: validation_failed = True

    archive_label = "📍 **Archive Focus: Bible**\n\n"
    
    if is_incomplete: grounded = "The reference is incomplete. Please provide book, chapter, and verse."
    elif is_specific and (not nodes or validation_failed): grounded = "This exact verse or chapter is not in my indexed Bible archive."
    elif not nodes:
        # Check if it's a number even in Bible mode
        num_match = re.search(r'\b(\d+)\b', query)
        if num_match:
            try:
                num = int(num_match.group(1))
                val = num_to_ga(num)
                grounded = f"The number {num} in Ga follows the operational counting logic: **{val}**."
            except: grounded = "This is not in my Ga Bible archives."
        else:
            grounded = "This is not in my Ga Bible archives."
    elif matched_meta and is_formattable_bible_record(matched_meta): grounded = format_bible_quote(matched_meta)
    else:
        from app.rag.retriever import format_retrieved_context
        ctx = format_retrieved_context(nodes)
        llm = get_llm(temperature=0, streaming=False, model=model)
        chain = ChatPromptTemplate.from_template(STRICT_GUARDRAIL_PROMPT) | llm
        grounded_resp = (await chain.ainvoke({"context_text": ctx, "query": query})).content
        grounded = "".join([p["text"] if isinstance(p, dict) else str(p) for p in grounded_resp]) if isinstance(grounded_resp, list) else str(grounded_resp)

    async for t in _stream_persona_response(query, archive_label + grounded, memory_window, model, stream): yield t


@instrument_time("RAG_General_Engine")
async def ask_general(
    query: str,
    conversation_id: str,
    user_id: str,
    memory_window: list,
    top_k: int = DEFAULT_TOP_K,
    stream: bool = True,
    model: str | None = None
) -> AsyncGenerator[str, None]:
    """General Knowledge RAG engine for history and stories."""
    import re
    from app.rag.utils import num_to_ga

    # --- PRE-SEARCH: Numerical / Counting Detection ---
    # Detect range queries: "count from 1 to 10", "1 to 10 in ga", "numbers 1 to 5"
    range_match = re.search(r'(\d+)\s+to\s+(\d+)', query, re.IGNORECASE)
    # Detect word-based range: "count from one to ten", "1 through 10"
    single_num_match = re.findall(r'\b(\d+)\b', query)

    if range_match:
        start, end = int(range_match.group(1)), int(range_match.group(2))
        if 0 < start <= end <= 1000 and (end - start) <= 50:  # Sane range guard
            table_lines = [
                "Here are the numbers you requested:\n",
                "| Number | Ga Translation |",
                "| :--- | :--- |"
            ]
            for n in range(start, end + 1):
                try:
                    val = num_to_ga(n).capitalize()
                    table_lines.append(f"| **{n}** | {val} |")
                except Exception:
                    table_lines.append(f"| **{n}** | (unknown) |")
            
            grounded = "\n".join(table_lines)
            logger.info(f"Range grounding: {start} to {end}")
            async for t in _stream_persona_response(query, grounded, memory_window, model, stream): yield t
            return

    # 1. Retrieval — use a larger top_k to cover more chunks (chunking is coarse)
    PHRASE_TOP_K = max(top_k, 20)
    nodes = retrieve_context(query, top_k=PHRASE_TOP_K, allowed_collections=["heritage_documents", "stories_documents"])

    # Filter out low-relevance results
    from app.rag.constants import MIN_RELEVANCE_SCORE
    nodes = [n for n in nodes if (getattr(n, 'score', 0.0) or 0.0) >= MIN_RELEVANCE_SCORE]

    if not nodes:
        # Single number fallback
        if single_num_match:
            try:
                num = int(single_num_match[0])
                val = num_to_ga(num)
                logger.info(f"Single numerical grounding: {num} -> {val}")
                grounded = f"**{num}** in Ga is **{val}**."
                async for t in _stream_persona_response(query, grounded, memory_window, model, stream): yield t
                return
            except Exception as e:
                logger.error(f"Numerical grounding error: {e}")

        async for t in _stream_persona_response(query, "This one is not in my archives yet.", memory_window, model, stream): yield t
        return

    # 2. Phrase-aware keyword scan across ALL retrieved JSONL chunks
    # Since the phrases file is chunked coarsely, we scan all returned nodes for exact matches
    import json as _json
    query_words = set(re.findall(r'\b\w+\b', query.lower()))
    # Remove common stop words
    stop_words = {"in", "ga", "the", "a", "an", "is", "are", "what", "how", "do", "you", "say", "tell", "me", "to"}
    query_words -= stop_words

    phrase_hits = []
    for node in nodes:
        src = (node.node.metadata.get('filename') or '')
        if not (src.lower().endswith('.jsonl') or 'phrase' in src.lower()):
            continue
        for line in node.node.get_content().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = _json.loads(line)
                eng = rec.get("english", "").strip()
                ga_text = rec.get("ga", "").strip()
                if not eng or not ga_text:
                    continue
                # Score: how many query words appear in the english phrase
                eng_lower = eng.lower()
                match_count = sum(1 for w in query_words if w in eng_lower)
                if match_count > 0:
                    phrase_hits.append((match_count, eng, ga_text))
            except (_json.JSONDecodeError, ValueError):
                continue

    if phrase_hits:
        # Sort by best match and take top results
        phrase_hits.sort(key=lambda x: x[0], reverse=True)
        best_hits = phrase_hits[:5]
        lines = [f"English: {eng} → Ga: {ga}" for _, eng, ga in best_hits]
        grounded = "\n".join(lines)
        logger.info(f"Phrase scan found {len(phrase_hits)} matches, showing top {len(best_hits)}")
        async for t in _stream_persona_response(query, grounded, memory_window, model, stream): yield t
        return

    # 3. Standard LLM grounding (for non-phrase heritage docs)
    from app.rag.retriever import format_retrieved_context
    from app.rag.prompts import STRICT_GUARDRAIL_PROMPT
    ctx = format_retrieved_context(nodes)
    
    llm = get_llm(temperature=0, streaming=False, model=model)
    chain = ChatPromptTemplate.from_template(STRICT_GUARDRAIL_PROMPT) | llm
    grounded_resp = (await chain.ainvoke({"context_text": ctx, "query": query})).content
    grounded = "".join([p["text"] if isinstance(p, dict) else str(p) for p in grounded_resp]) if isinstance(grounded_resp, list) else str(grounded_resp)
    
    async for t in _stream_persona_response(query, grounded, memory_window, model, stream): yield t


@instrument_time("Unified_RAG_Entry")
async def ask(
    query: str,
    conversation_id: str | None,
    user_id: str,
    top_k: int = DEFAULT_TOP_K,
    stream: bool = True,
    skip_user_message: bool = False,
    model: str | None = None,
    mode: str = "auto"
) -> AsyncGenerator[str, None]:
    """
    Unified RAG Entry Point.
    Routes to either ask_bible or ask_general based on mode or query detection.
    Implements Hybrid Routing for faster response times on simple queries.
    """
    chat_repo = await Repositories.chat()
    msg_repo = await Repositories.messages()
    
    q_low = query.lower().strip()
    
    # --- STEP 1: CACHE CHECK (Fast Path) ---
    if not stream:
        cache_key = generate_cache_key("ask_v1", query=query, model=model, mode=mode)
        if cache_key in llm_cache:
            logger.info(f"PERF: Cache hit for query: {query}")
            # Yield in a way that respects the generator interface
            for segment in [llm_cache[cache_key]]:
                yield segment
            return

    # --- STEP 2: HYBRID ROUTING / QUERY CLASSIFICATION ---
    is_greeting = q_low in ["hi", "hello", "hey", "hɛloo", "manye", "ojekoo", "good morning", "how are you"]
    
    # Bible Citation Check (e.g. "Genesis 1:1")
    import re
    citation_match = re.search(r'(genesis|exodus|leviticus|numbers|deuteronomy|mose)\s+(\d+)(?:[\s:]+(\d+))?', q_low)
    
    if is_greeting:
        logger.info("ROUTING: Fast-path greeting detected")
        async for token in _stream_persona_response(query, "", [], model, stream):
            yield token
        return

    # If it's a specific Bible citation, we can potentially skip pure vector retrieval
    # and pass it to ask_bible with a 'specific' hint
    if citation_match:
        logger.info(f"ROUTING: Bible citation detected: {citation_match.group(0)}")
        mode = "bible"

    # --- STEP 3: CONTEXT & SESSION INITIALIZATION ---
    if conversation_id is None:
        conversation_id = str(uuid.uuid4())
        await chat_repo.initialize_session(conversation_id, user_id=user_id)
    
    conv_context = await get_conversation_context(conversation_id, user_id=user_id, model=model)
    memory_window = conv_context.get("memory_window", [])

    # Route logic
    target_mode = mode
    if target_mode == "auto":
        is_bible = any(b in q_low for b in ["genesis", "exodus", "leviticus", "numbers", "deuteronomy", "mose", "verse", "chapter", "scripture"]) or (":" in q_low and any(c.isdigit() for c in q_low))
        target_mode = "bible" if is_bible else "general"

    full_response = ""
    try:
        if target_mode == "bible":
            engine = ask_bible(query, conversation_id, user_id, memory_window, top_k, stream, model)
        else:
            engine = ask_general(query, conversation_id, user_id, memory_window, top_k, stream, model)

        async for token in engine:
            token_str = str(token) if not isinstance(token, str) else token
            full_response += token_str
            yield token

        # --- STEP 4: POST-RESPONSE TASKS & CACHING ---
        if not stream:
            llm_cache[cache_key] = full_response

        try:
            await msg_repo.save_interaction(conversation_id, query=query, response=full_response, user_id=user_id)
            await chat_repo.update_activity(conversation_id)
            # Background tasks with error logging callbacks
            summarize_task = asyncio.create_task(summarize_conversation_messages(conversation_id, user_id=user_id, model=model))
            summarize_task.add_done_callback(lambda t: logger.error(f"Summarization failed: {t.exception()}") if t.exception() else None)

            title_task = asyncio.create_task(generate_conversation_title(conversation_id, user_id=user_id, model=model))
            title_task.add_done_callback(lambda t: logger.error(f"Title generation failed: {t.exception()}") if t.exception() else None)
        except Exception as e:
            logger.error(f"Post-Response Background Task Error: {e}")

    except Exception as e:
        logger.error(f"RAG Router Error: {e}")
        yield "Hɛloo! I'm having trouble routing your request. Please try again in a moment."
