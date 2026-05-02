"""
Qdrant vector store setup using LlamaIndex.
Handles collection creation and vector store initialization.
"""

import logging
from functools import lru_cache
from typing import Optional
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core import VectorStoreIndex
from qdrant_client import QdrantClient, AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams

from app.core.config import settings
from app.rag.embeddings import get_embeddings
from app.rag.constants import COLLECTION_NAME
from app.core.resilience import retry_db

logger = logging.getLogger(__name__)

# Module-level cache for VectorStoreIndex instances to avoid recreating on every retrieval
_index_cache: dict[str, VectorStoreIndex] = {}


@lru_cache()
def get_qdrant_client() -> QdrantClient:
    """
    Get Qdrant client instance.
    Supports both local Qdrant and Qdrant Cloud (with API key).
    
    Returns:
        QdrantClient: Qdrant client
    """
    # For Qdrant Cloud, API key is required
    if settings.qdrant_api_key:
        return QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=60,
            prefer_grpc=True
        )
    return QdrantClient(url=settings.qdrant_url, timeout=60, prefer_grpc=True)


@lru_cache()
def get_async_qdrant_client() -> AsyncQdrantClient:
    """
    Get Async Qdrant client instance.
    
    Returns:
        AsyncQdrantClient: Async Qdrant client
    """
    if settings.qdrant_api_key:
        return AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=60
        )
    return AsyncQdrantClient(url=settings.qdrant_url, timeout=60)


@retry_db
def get_vector_store(collection_name: str = COLLECTION_NAME) -> QdrantVectorStore:
    """
    Get or create Qdrant vector store.
    
    Args:
        collection_name: Name of the Qdrant collection
        
    Returns:
        QdrantVectorStore: LlamaIndex Qdrant vector store instance
        
    Raises:
        ConnectionError: If Qdrant is not available
    """
    client = get_qdrant_client()
    
    # Try to connect to verify Qdrant is running
    try:
        client.get_collections()
    except Exception as e:
        error_msg = f"Failed to connect to Qdrant at {settings.qdrant_url}."
        if settings.qdrant_api_key:
            error_msg += " For Qdrant Cloud, please verify your API key is correct."
        else:
            error_msg += " For local Qdrant, ensure it's running: docker run -p 6333:6333 qdrant/qdrant"
        error_msg += f" Error: {str(e)}"
        raise ConnectionError(error_msg) from e
    
    # Get embedding dimension (all-MiniLM-L6-v2 has 384 dimensions)
    embeddings = get_embeddings()
    try:
        embedding_dim = embeddings.get_query_embedding_dimension()
    except (AttributeError, NotImplementedError):
        # Fallback to known dimension for all-MiniLM-L6-v2
        embedding_dim = 384
    
    # Check if collection exists, create if not
    try:
        collections = client.get_collections()
        collection_exists = any(col.name == collection_name for col in collections.collections)
        
        if not collection_exists:
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=embedding_dim,
                    distance=Distance.COSINE
                )
            )
            
        # Ensure payload indexes exist (for both new and existing collections)
        _ensure_payload_indexes(client, collection_name)

    except Exception as e:
        # If it's a conflict error (collection already exists), we can ignore it
        if "already exists" in str(e).lower():
            _ensure_payload_indexes(client, collection_name)
        else:
            # Re-try creation just in case it was a transient fetch error
            try:
                client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(
                        size=embedding_dim,
                        distance=Distance.COSINE
                    )
                )
                _ensure_payload_indexes(client, collection_name)
            except Exception as create_error:
                if "already exists" in str(create_error).lower():
                    _ensure_payload_indexes(client, collection_name)
                else:
                    error_msg = f"Failed to create Qdrant collection: {create_error}."
                    if settings.qdrant_api_key:
                        error_msg += " Please verify your Qdrant Cloud API key has the necessary permissions."
                    raise ConnectionError(error_msg) from create_error

    
    return QdrantVectorStore(
        client=client,
        aclient=get_async_qdrant_client(),
        collection_name=collection_name
    )


def _ensure_payload_indexes(client: QdrantClient, collection_name: str):
    """Ensure required metadata indexes exist for fast filtering and deletion."""
    from qdrant_client.models import PayloadSchemaType
    
    # Keyword fields for exact matching
    keyword_fields = ["file_path", "filename", "category", "book", "chapter", "verse"]
    
    # Integer fields for range matching (if needed)
    integer_fields = ["chapter_num", "verse_num"]
    
    for field in keyword_fields:
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD
            )
        except Exception:
            pass
            
    for field in integer_fields:
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field,
                field_schema=PayloadSchemaType.INTEGER
            )
        except Exception:
            pass


def collection_exists(collection_name: str = COLLECTION_NAME) -> bool:
    """
    Check if Qdrant collection exists.

    Args:
        collection_name: Name of the collection to check

    Returns:
        bool: True if collection exists, False otherwise
    """
    try:
        client = get_qdrant_client()
        collections = client.get_collections()
        return any(col.name == collection_name for col in collections.collections)
    except Exception:
        # Qdrant not available or connection failed
        return False


def get_index(collection_name: str = COLLECTION_NAME) -> VectorStoreIndex:
    """
    Get or create a cached VectorStoreIndex for the given collection.
    This avoids expensive reconstruction on every retrieval call.

    Args:
        collection_name: Name of the Qdrant collection

    Returns:
        VectorStoreIndex: Cached index instance
    """
    if collection_name not in _index_cache:
        logger.debug(f"Creating new VectorStoreIndex for collection: {collection_name}")
        vector_store = get_vector_store(collection_name)
        embeddings = get_embeddings()
        _index_cache[collection_name] = VectorStoreIndex.from_vector_store(
            vector_store=vector_store,
            embed_model=embeddings
        )
    return _index_cache[collection_name]


def clear_index_cache(collection_name: str | None = None) -> None:
    """
    Clear the index cache. Useful when collections are modified or rebuilt.

    Args:
        collection_name: If provided, clear only this collection. Otherwise clear all.
    """
    global _index_cache
    if collection_name:
        _index_cache.pop(collection_name, None)
        logger.info(f"Cleared index cache for collection: {collection_name}")
    else:
        _index_cache.clear()
        logger.info("Cleared all index caches")

