"""
Qdrant vector store setup using LlamaIndex.
Handles collection creation and vector store initialization.
"""

from typing import Optional
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from app.core.config import settings
from app.rag.embeddings import get_embeddings


COLLECTION_NAME = "heritage_documents"


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
            api_key=settings.qdrant_api_key
        )
    return QdrantClient(url=settings.qdrant_url)


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
    except Exception as e:
        # Collection might not exist, create it
        try:
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=embedding_dim,
                    distance=Distance.COSINE
                )
            )
        except Exception as create_error:
            error_msg = f"Failed to create Qdrant collection: {create_error}."
            if settings.qdrant_api_key:
                error_msg += " Please verify your Qdrant Cloud API key has the necessary permissions."
            else:
                error_msg += " Please ensure Qdrant is running."
            raise ConnectionError(error_msg) from create_error
    
    return QdrantVectorStore(
        client=client,
        collection_name=collection_name
    )


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

