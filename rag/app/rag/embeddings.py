"""
HuggingFace embeddings module using llama-index-embeddings-huggingface.
Provides shared embeddings instance for all components.
"""

from llama_index.embeddings.huggingface import HuggingFaceEmbedding

# Shared embeddings instance
# Model: sentence-transformers/all-MiniLM-L6-v2 (free, local)
_embeddings_instance = None


def get_embeddings() -> HuggingFaceEmbedding:
    """
    Get or create shared HuggingFace embeddings instance.
    
    Returns:
        HuggingFaceEmbedding: Shared embeddings instance
    """
    global _embeddings_instance
    
    if _embeddings_instance is None:
        _embeddings_instance = HuggingFaceEmbedding(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )
    
    return _embeddings_instance

