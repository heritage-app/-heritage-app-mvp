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
from app.rag.constants import COLLECTION_NAME, DEFAULT_TOP_K, MIN_RELEVANCE_SCORE


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
        "psa", "gen", "mat", "luk", "mar", "rev", "exo", "proverbs"
    ]) or ("chapter" in q_low or "verse" in q_low)
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
        "bible", "verse", "scripture", "psalm", "gospel", "testament", "chapter",
        "john", "matthew", "luke", "mark", "genesis", "exodus", "revelation",
        "psa", "gen", "mat", "luk", "mar", "rev", "exo", "proverbs"
    ]):
        # Match new category tag
        filters.append(MetadataFilter(key="category", value="bible"))
        # Match existing filename patterns
        # Using uppercase "BIBLE" as per user's Qdrant data snippet
        filters.append(MetadataFilter(key="filename", value="BIBLE", operator=FilterOperator.CONTAINS))
        filters.append(MetadataFilter(key="file_path", value="BIBLE", operator=FilterOperator.CONTAINS))
        filters.append(MetadataFilter(key="filename", value="Ga - data.pdf", operator=FilterOperator.CONTAINS)) # Fallback

    # Story/Heritage Intent
    if any(w in q_low for w in ["story", "folktale", "ananse", "history", "tradition"]):
        filters.append(MetadataFilter(key="category", value="story"))
        filters.append(MetadataFilter(key="filename", value="data", operator=FilterOperator.CONTAINS)) # For 'Ga - data.pdf'
        filters.append(MetadataFilter(key="filename", value="heritage", operator=FilterOperator.CONTAINS))
        filters.append(MetadataFilter(key="filename", value="phrases", operator=FilterOperator.CONTAINS))

    if not filters:
        return None
        
    return MetadataFilters(filters=filters, condition=FilterCondition.OR)


def _has_relevant_results(nodes: List[NodeWithScore], min_score: float = MIN_RELEVANCE_SCORE) -> bool:
    """Check if retrieved nodes have relevant results based on similarity scores."""
    return any((getattr(node, 'score', 0.0) >= min_score) for node in nodes)


def retrieve_context(
    query: str, 
    top_k: int = DEFAULT_TOP_K, 
    max_retries: int = 2
) -> List[NodeWithScore]:
    """
    Retrieve relevant context chunks with intent-aware filtering.
    """
    embeddings = get_embeddings()
    vector_store = get_vector_store(COLLECTION_NAME)
    
    # 1. Create index
    index = VectorStoreIndex.from_vector_store(
        vector_store=vector_store,
        embed_model=embeddings
    )
    
    # 2. Detect Filter Intent
    intent_filters = _get_intent_filters(query)
    
    # 3. Create Retriever with initial filters
    retriever = index.as_retriever(
        similarity_top_k=top_k,
        filters=intent_filters
    )
    
    best_nodes: List[NodeWithScore] = []
    best_score = 0.0
    
    # 4. Try variations
    for attempt in range(max_retries):
        for variant in _generate_query_variations(query, attempt):
            try:
                nodes = retriever.retrieve(QueryBundle(query_str=variant))
                
                if not nodes:
                    # If intent filtering returned nothing, try once without filters
                    if intent_filters and attempt == 1:
                        broad_retriever = index.as_retriever(similarity_top_k=top_k)
                        nodes = broad_retriever.retrieve(QueryBundle(query_str=variant))
                    
                    if not nodes:
                        continue

                current_max_score = max(getattr(n, 'score', 0.0) for n in nodes)
                
                # Immediate return for high confidence
                if current_max_score >= MIN_RELEVANCE_SCORE:
                    return nodes
                
                # Track best fallback
                if current_max_score > best_score:
                    best_score = current_max_score
                    best_nodes = nodes
                        
            except Exception:
                continue
    
    return best_nodes



def format_retrieved_context(nodes: List[NodeWithScore]) -> str:
    """
    Format retrieved nodes into a context string.
    
    Args:
        nodes: List of retrieved nodes with scores
        
    Returns:
        str: Formatted context string
    """
    context_parts = []
    
    for i, node in enumerate(nodes, 1):
        text = node.node.text if hasattr(node.node, 'text') else str(node.node)
        score = node.score if hasattr(node, 'score') else 0.0
        context_parts.append(f"[Chunk {i} (score: {score:.3f})]\n{text}\n")
    
    return "\n".join(context_parts)




