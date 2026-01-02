"""
Document indexing module using LlamaIndex.
Handles one-time indexing and document processing.
"""

import os
from io import BytesIO
from pathlib import Path
from typing import List, Optional
from llama_index.core import VectorStoreIndex, Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.readers.file import FlatReader
import fitz  # PyMuPDF for PDF files

from app.rag.embeddings import get_embeddings
from app.rag.vector_store import get_vector_store, collection_exists
from app.storage.supabase import download_document


DATA_DIR = Path("data")
COLLECTION_NAME = "heritage_documents"


async def index_document_from_storage(file_path: str, metadata: Optional[dict] = None) -> None:
    """
    Index a single document directly from Supabase Storage without saving locally.
    
    Args:
        file_path: Path to document in Supabase Storage
        metadata: Optional metadata to attach to document
    """
    # Download document content from Supabase (in memory only)
    content = await download_document(file_path)
    
    # Index directly from memory
    await index_from_bytes(content, file_path, metadata)


async def index_from_bytes(content: bytes, file_path: str, metadata: Optional[dict] = None) -> None:
    """
    Index a document directly from bytes in memory.
    
    Args:
        content: Document content as bytes
        file_path: Original file path (for determining file type)
        metadata: Optional metadata to attach to document
    """
    # Detect file type from path
    file_path_obj = Path(file_path)
    file_extension = file_path_obj.suffix.lower()
    
    # Extract text based on file type
    if file_extension == ".pdf":
        # Use PyMuPDF for PDF files - open from memory
        doc = fitz.open(stream=content, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        # Create Document from extracted text
        documents = [Document(text=text)]
    else:
        # For text-based files, decode bytes to string
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            # Try other encodings if UTF-8 fails
            try:
                text = content.decode('latin-1')
            except Exception:
                text = content.decode('utf-8', errors='ignore')
        
        # Create Document from text
        documents = [Document(text=text)]
    
    # Add metadata if provided
    if metadata:
        for doc in documents:
            doc.metadata.update(metadata)
    
    # Get embeddings and vector store
    embeddings = get_embeddings()
    vector_store = get_vector_store(COLLECTION_NAME)
    
    # Create node parser (chunker)
    node_parser = SentenceSplitter(chunk_size=1024, chunk_overlap=200)
    
    # Create index and insert documents
    index = VectorStoreIndex.from_vector_store(
        vector_store=vector_store,
        embed_model=embeddings
    )
    
    # Insert documents into index
    for doc in documents:
        nodes = node_parser.get_nodes_from_documents([doc])
        index.insert_nodes(nodes)


async def is_document_indexed(file_path: str) -> bool:
    """
    Check if a document is already indexed in Qdrant by checking for nodes with matching file_path metadata.
    
    Args:
        file_path: Path to document in storage
        
    Returns:
        bool: True if document is indexed, False otherwise
    """
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        
        # Get Qdrant client
        from app.rag.vector_store import get_qdrant_client
        client = get_qdrant_client()
        
        # Check if collection exists
        if not collection_exists(COLLECTION_NAME):
            return False
        
        # Search for any points with matching file_path in metadata
        try:
            # Use scroll to check for documents with matching metadata
            # Check for file_path or filename in metadata
            results = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="file_path",
                            match=MatchValue(value=file_path)
                        )
                    ]
                ),
                limit=1
            )
            
            # If we found any points, the document is indexed
            if results[0]:  # results is a tuple (points, next_page_offset)
                return len(results[0]) > 0
            
            # Also check for filename in metadata (backward compatibility)
            results = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="filename",
                            match=MatchValue(value=file_path)
                        )
                    ]
                ),
                limit=1
            )
            
            return len(results[0]) > 0 if results[0] else False
            
        except Exception:
            # If scroll fails, try a different approach - just check if collection has any points
            # This is a fallback - not as precise but better than nothing
            collection_info = client.get_collection(COLLECTION_NAME)
            # If collection exists and has points, we assume it might be indexed
            # This is not perfect but works as a fallback
            return collection_info.points_count > 0
            
    except Exception:
        # If anything fails, assume not indexed to be safe
        return False


async def index_local_document(file_path: str, metadata: Optional[dict] = None) -> None:
    """
    Index a local document file (for backward compatibility and initial indexing).
    
    Args:
        file_path: Path to local document file
        metadata: Optional metadata to attach to document
    """
    # Read file content
    local_path = Path(file_path)
    content = local_path.read_bytes()
    
    # Index from bytes
    await index_from_bytes(content, file_path, metadata)


async def index_directory(directory_path: str, metadata: Optional[dict] = None) -> None:
    """
    Index all documents in a directory.
    
    Args:
        directory_path: Path to directory containing documents
        metadata: Optional metadata to attach to all documents
    """
    dir_path = Path(directory_path)
    
    # Supported file extensions
    supported_extensions = {".pdf", ".txt", ".docx", ".md", ".html", ".json", ".csv"}
    
    # Find all supported files
    files = [f for f in dir_path.rglob("*") if f.suffix.lower() in supported_extensions]
    
    for file_path in files:
        await index_local_document(str(file_path), metadata)


def initial_index_if_needed() -> bool:
    """
    Perform initial indexing if collection does not exist.
    Only runs once if collection is empty.
    
    Returns:
        bool: True if collection was created, False if collection already exists or Qdrant unavailable
    """
    try:
        if collection_exists(COLLECTION_NAME):
            # Collection exists, skip indexing
            return False
        
        # Collection doesn't exist, but we don't have documents to index yet
        # This will be handled by the upload endpoint or worker
        # Just create the collection structure
        get_vector_store(COLLECTION_NAME)
        return True
    except (ConnectionError, Exception) as e:
        # Qdrant not available - this is OK, it will be available when needed
        # Log the issue but don't fail startup
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Qdrant not available during startup: {e}. The application will start, but vector operations will fail until Qdrant is running.")
        return False

