"""
Document retrieval module using LlamaIndex.
Handles retrieval of relevant chunks from vector store with flexible retry logic.
"""

from typing import List, Optional
from llama_index.core import VectorStoreIndex, QueryBundle
from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.schema import NodeWithScore
from llama_index.core.vector_stores import MetadataFilter, MetadataFilters, FilterOperator, FilterCondition

from app.rag.embeddings import get_embeddings
from app.rag.vector_store import get_vector_store
from app.rag.constants import COLLECTION_NAME, COLLECTION_MAP, DEFAULT_TOP_K, MIN_RELEVANCE_SCORE


def get_retriever(top_k: int = DEFAULT_TOP_K) -> VectorIndexRetriever:
    """
    Get LlamaIndex retriever instance.
    
    Args:
        top_k: Number of top chunks to retrieve
        
    Returns:
        VectorIndexRetriever: Retriever instance
    """
    embeddings = get_embeddings()
    vector_store = get_vector_store(COLLECTION_NAME)
    
    # Create index from existing vector store
    index = VectorStoreIndex.from_vector_store(
        vector_store=vector_store,
        embed_model=embeddings
    )
    
    # Create retriever
    retriever = VectorIndexRetriever(
        index=index,
        similarity_top_k=top_k
    )
    
    return retriever


def _generate_query_variations(query: str, attempt: int) -> List[str]:
    """
    Generate query variations for retry attempts.
    """
    variations = [query]
    q_low = query.lower()
    
    # Detect intent
    is_bible = any(w in q_low for w in [
        "bible", "verse", "scripture", "psalm", "gospel", "testament",
        "john", "matthew", "luke", "mark", "genesis", "exodus", "revelation",
        "psa", "gen", "mat", "luk", "mar", "rev", "exo", "proverbs",
        "mose", "yitso", "klɛŋklɛŋ", "kuku", "1:", "2:", "3:", "4:", "5:"
    ]) or (":" in q_low and any(c.isdigit() for c in q_low))
    is_story = any(w in q_low for w in ["story", "folktale", "ananse", "history", "traditional", "tale"])
    is_random = "random" in q_low or "any" in q_low or "some" in q_low

    if attempt == 0:
        if is_random and is_bible:
            import random
            # Inject a random fragment to vary results for "random" requests
            variations.append(f"scripture {random.choice(['wisdom', 'life', 'truth', 'heritage', 'spirit'])}")
        elif is_bible:
            variations.append(f"scripture {query}")
        elif is_story:
            variations.append(f"traditional story {query}")
    
    elif attempt == 1:
        if is_random and is_bible:
            variations.append("Ga Bible verse scripture")
        elif "ga" not in q_low and "translat" not in q_low:
            variations.append(f"Ga translation {query}")
        else:
            variations.append(f"meaning of {query}")

    return variations


def _get_intent_filters(query: str) -> Optional[MetadataFilters]:
    """
    Generate LlamaIndex MetadataFilters based on search intent.
    Matches both new structured tags and existing filename patterns.
    """
    q_low = query.lower()
    filters = []
    
    # Bible Intent
    if any(w in q_low for w in [
        "bible", "bibele", "verse", "scripture", "psalm", "gospel", "testament", "chapter",
        "john", "matthew", "luke", "mark", "genesis", "exodus", "revelation",
        "psa", "gen", "mat", "luk", "mar", "rev", "exo", "proverbs", "mose"
    ]):
        # Match new category tag
        filters.append(MetadataFilter(key="category", value="bible"))

    # Story/Heritage Intent
    if any(w in q_low for w in ["story", "folktale", "ananse", "history", "tradition"]):
        filters.append(MetadataFilter(key="category", value="story"))

    if not filters:
        return None
        
    from llama_index.core.vector_stores import FilterCondition
    return MetadataFilters(filters=filters, condition=FilterCondition.AND)


def _has_relevant_results(nodes: List[NodeWithScore], min_score: float = MIN_RELEVANCE_SCORE) -> bool:
    """Check if retrieved nodes have relevant results based on similarity scores."""
    return any((getattr(node, 'score', 0.0) >= min_score) for node in nodes)


def retrieve_context(
    query: str, 
    top_k: int = DEFAULT_TOP_K, 
    max_retries: int = 2,
    filters: Optional[MetadataFilters] = None,
    allowed_collections: Optional[List[str]] = None
) -> List[NodeWithScore]:
    """
    Retrieve relevant context chunks.
    If allowed_collections is provided, strictly search only those collections.
    Otherwise, search across all available collections in COLLECTION_MAP.
    """
    embeddings = get_embeddings()
    all_nodes: List[NodeWithScore] = []
    
    # Auto-detect intent filters if not provided
    if filters is None:
        filters = _get_intent_filters(query)

    # 1. Gather collections to search
    if allowed_collections:
        target_collections = allowed_collections
    else:
        target_collections = list(COLLECTION_MAP.values())
        if COLLECTION_NAME not in target_collections:
            target_collections.append(COLLECTION_NAME)

    # If filters specify a category, prioritize that collection
    if not allowed_collections and filters:
        for f in filters.filters:
            if f.key == "category" and f.value in COLLECTION_MAP:
                target_coll = COLLECTION_MAP[f.value]
                # Move target collection to front
                if target_coll in target_collections:
                    target_collections.remove(target_coll)
                    target_collections.insert(0, target_coll)
                
                # [VERBOSE LOGGING]
                print(f"DEBUG: Intent detected! Prioritizing collection: '{target_coll}'")

    # 2. Extract intent variations
    variations = []
    # If we have filters, we might not need variations as much, 
    # but we keep them for robustness if the first variant misses
    for attempt in range(max_retries):
        variations.extend(_generate_query_variations(query, attempt))
    
    # Remove duplicates but preserve order
    variations = list(dict.fromkeys(variations))
    
    # 3. Search across all collections
    for coll in target_collections:
        try:
            vector_store = get_vector_store(coll)
            index = VectorStoreIndex.from_vector_store(
                vector_store=vector_store,
                embed_model=embeddings
            )
            
            # Create retriever for this specific collection
            # Pass filters ONLY if they are relevant to this collection
            # "bible" collection supports book/chapter/verse. Others might not.
            active_filters = filters
            if coll != "bibele_documents" and filters:
                # Remove verse/book/chapter filters for non-bible collections to avoid 400 errors
                active_filters = MetadataFilters(filters=[
                    f for f in filters.filters 
                    if f.key in ["category", "file_path", "filename"]
                ], condition=filters.condition)
            
            retriever = index.as_retriever(
                similarity_top_k=top_k,
                filters=active_filters
            )
            
            for variant in variations:
                nodes = retriever.retrieve(QueryBundle(query_str=variant))
                if nodes:
                    all_nodes.extend(nodes)
                    # If we found exact matches via filters, we might be able to stop early
                    if filters and all_nodes:
                        break
            
            # If we found robust results with filters in the target collection, don't search others
            if filters and all_nodes and coll == target_collections[0]:
                break
                    
        except Exception as e:
            # If a collection doesn't exist yet, skip it
            print(f"Skipping collection '{coll}' search: {e}")
            continue

    if not all_nodes:
        return []

    # 4. Filter and Rank
    # Distinct nodes by content to avoid duplicates from variations
    seen_nodes = {}
    from app.rag.validator import is_retrievable_bible_record
    
    for n in all_nodes:
        metadata = n.node.metadata if hasattr(n.node, 'metadata') else {}
        
        # [HARD VALIDATION LAYER] Drop entirely malformed or noise-polluted Bible nodes 
        if metadata.get("category") == "bible" and not is_retrievable_bible_record(metadata):
            continue
            
        node_key = n.node.get_content()[:200]
        if node_key not in seen_nodes or n.score > seen_nodes[node_key].score:
            seen_nodes[node_key] = n
            
    final_nodes = list(seen_nodes.values())
    
    # Sort by score descending
    final_nodes.sort(key=lambda x: x.score if hasattr(x, 'score') else 0.0, reverse=True)
    
    # Return top_k across all collections
    return final_nodes[:top_k]



def _format_bible_evidence(metadata: dict) -> str:
    return (
        "[BIBLE_RECORD]\n"
        f"book={metadata.get('book', '')}\n"
        f"chapter_num={metadata.get('chapter_num', '')}\n"
        f"verse_num={metadata.get('verse_num', '')}\n"
        f"verse_ref={metadata.get('verse_ref', '')}\n"
        f"reference_display={metadata.get('reference_display', '')}\n"
        f"ga_version_name={metadata.get('ga_version_name', 'Ŋmalɛ Krɔŋkrɔŋ Lɛ')}\n"
        f"ga_version_abbr={metadata.get('ga_version_abbr', 'NEGAB')}\n"
        f"english_version_name={metadata.get('english_version_name', 'King James Version')}\n"
        f"english_version_abbr={metadata.get('english_version_abbr', 'KJV')}\n"
        f"ga={metadata.get('ga', '').strip()}\n"
        f"en={metadata.get('en', '').strip()}\n"
        f"source_name={metadata.get('source_name', '')}\n"
        f"ga_text_missing={metadata.get('ga_text_missing', '')}\n"
        f"english_text_missing={metadata.get('english_text_missing', '')}\n"
        "[/BIBLE_RECORD]\n"
    )

def format_retrieved_context(nodes: List[NodeWithScore]) -> str:
    """
    Format retrieved nodes into a context string.
    Prioritizes structured evidence for Bible queries to prevent Formatting Drift.
    """
    context_parts = []
    
    for i, node in enumerate(nodes, 1):
        # Extract metadata
        metadata = node.node.metadata if hasattr(node.node, 'metadata') else {}
        
        # STRICT BIBLE FORMAT: Provide raw machine-readable arrays, never presentation text
        if metadata.get("category") == "bible":
            context_parts.append(_format_bible_evidence(metadata))
            continue
            
        text = node.node.text if hasattr(node.node, 'text') else str(node.node)
        score = node.score if hasattr(node, 'score') else 0.0
        full_filename = metadata.get('filename') or metadata.get('file_path') or "Generic Heritage Archive"
        
        # Clean up path
        if "\\" in full_filename:
            full_filename = full_filename.split("\\")[-1]
            
        # Create cleaned display name (remove extension and timestamps)
        display_name = full_filename
        if "." in display_name:
            display_name = ".".join(display_name.split(".")[:-1])
            
        import re
        display_name = re.sub(r'_\d{8}_\d{6}', '', display_name)
        source_citation = display_name.replace('_', ' ').strip()
        
        # --- JSONL Phrase Parser ---
        # If the source is a phrases/data file stored as JSONL blobs, extract readable pairs
        formatted_text = text
        if "phrase" in full_filename.lower() or full_filename.lower().endswith(".jsonl"):
            import json
            pairs = []
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                # Handle partial lines starting with comma or closing brace
                if line.startswith(","):
                    line = line[1:].strip()
                try:
                    record = json.loads(line)
                    eng = record.get("english", "").strip()
                    ga = record.get("ga", "").strip()
                    if eng and ga:
                        pairs.append(f"English: {eng} → Ga: {ga}")
                except (json.JSONDecodeError, ValueError):
                    # Not parseable JSON — include as-is if it contains useful text
                    if "→" in line or ("english" in line.lower() and "ga" in line.lower()):
                        pairs.append(line)
            if pairs:
                formatted_text = "\n".join(pairs)
        
        context_parts.append(f"[Source: {source_citation} | Score: {score:.3f}]\n{formatted_text}\n")
    
    return "\n".join(context_parts)




