"""
Document retrieval module using LlamaIndex.
Handles retrieval of relevant chunks from vector store with flexible retry logic.
"""

from typing import List, Optional
from llama_index.core import VectorStoreIndex, QueryBundle
from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.schema import NodeWithScore

from app.rag.embeddings import get_embeddings
from app.rag.vector_store import get_vector_store


COLLECTION_NAME = "heritage_documents"
DEFAULT_TOP_K = 5
MIN_RELEVANCE_SCORE = 0.3  # Minimum similarity score to consider a result relevant


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
    
    Args:
        query: Original query string
        attempt: Current attempt number (0-based)
        
    Returns:
        List[str]: List of query variations
    """
    variations = [query]  # Always include original query first
    
    # Attempt 1: Try with "Ga language" or "translation" context
    if attempt == 0:
        if "ga" not in query.lower() and "translat" not in query.lower():
            variations.append(f"Ga language {query}")
            variations.append(f"{query} translation")
    
    # Attempt 2: Try related terms and synonyms
    elif attempt == 1:
        # Add language context
        variations.append(f"{query} meaning")
        variations.append(f"{query} Ga English")
        # Try removing common words that might interfere
        words = query.split()
        if len(words) > 3:
            variations.append(" ".join(words[-3:]))  # Last 3 words
    
    # Attempt 3: Try semantic variations
    elif attempt == 2:
        variations.append(f"how to say {query}")
        variations.append(f"{query} in Ga language")
        # Try with question words
        if not query.lower().startswith(('what', 'how', 'where', 'when', 'why')):
            variations.append(f"what is {query}")
    
    return variations


def _has_relevant_results(nodes: List[NodeWithScore], min_score: float = MIN_RELEVANCE_SCORE) -> bool:
    """
    Check if retrieved nodes have relevant results based on similarity scores.
    
    Args:
        nodes: List of retrieved nodes with scores
        min_score: Minimum similarity score threshold
        
    Returns:
        bool: True if any node has score >= min_score
    """
    if not nodes:
        return False
    
    # Check if any node has a reasonable similarity score
    # Cosine similarity ranges from -1 to 1, but typically 0.3+ is considered relevant
    return any(
        (node.score if hasattr(node, 'score') else 0.0) >= min_score
        for node in nodes
    )


def retrieve_context(
    query: str, 
    top_k: int = DEFAULT_TOP_K, 
    metadata_filter: Optional[dict] = None,
    max_retries: int = 3
) -> List[NodeWithScore]:
    """
    Retrieve relevant context chunks for a query with flexible retry logic.
    Tries up to max_retries times with query variations if initial retrieval is not successful.
    
    Args:
        query: Query string
        top_k: Number of chunks to retrieve
        metadata_filter: Optional metadata filter dict
        max_retries: Maximum number of retry attempts with query variations
        
    Returns:
        List[NodeWithScore]: List of retrieved nodes with scores (may be empty)
    """
    retriever = get_retriever(top_k=top_k)
    
    best_nodes: List[NodeWithScore] = []
    best_score = 0.0
    
    # Try retrieval with original query and variations
    for attempt in range(max_retries):
        query_variations = _generate_query_variations(query, attempt)
        
        for query_variant in query_variations:
            try:
                # Create query bundle
                query_bundle = QueryBundle(query_str=query_variant)
                
                # Retrieve nodes
                nodes = retriever.retrieve(query_bundle)
                
                # Apply metadata filter if provided
                if metadata_filter:
                    filtered_nodes = []
                    for node in nodes:
                        node_metadata = node.node.metadata if hasattr(node.node, 'metadata') else {}
                        if all(node_metadata.get(k) == v for k, v in metadata_filter.items()):
                            filtered_nodes.append(node)
                    nodes = filtered_nodes
                
                # Check if we have relevant results
                if _has_relevant_results(nodes):
                    # Return best results found so far
                    return nodes
                
                # Track best results across attempts
                if nodes:
                    max_score = max(
                        (node.score if hasattr(node, 'score') else 0.0) for node in nodes
                    )
                    if max_score > best_score:
                        best_score = max_score
                        best_nodes = nodes
                        
            except Exception:
                # Continue to next variation on error
                continue
    
    # Return best results found (may be empty or low quality)
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




