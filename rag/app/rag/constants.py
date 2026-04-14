"""
Constants for the RAG system.
"""

COLLECTION_NAME = "heritage_documents"
DEFAULT_TOP_K = 5
MIN_RELEVANCE_SCORE = 0.3
MEMORY_WINDOW_SIZE = 10
INDEXER_INTERVAL_HOURS = 1

# Collection Mapping based on category
COLLECTION_MAP = {
    "bible": "bibele_documents",
    "stories": "stories_documents",
    "heritage": "heritage_documents"
}

def get_collection_name(category: str | None) -> str:
    """Helper to route documents and queries to the correct collection."""
    if not category:
        return COLLECTION_NAME
    return COLLECTION_MAP.get(category.lower(), COLLECTION_NAME)
