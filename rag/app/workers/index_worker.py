"""
Background indexing worker.
Periodically checks Supabase Storage for unindexed documents and indexes them.
Runs every hour by default.
"""

import asyncio
import logging
from typing import List
from app.storage.supabase import list_storage_files, get_supabase_client
from app.rag.indexer import index_document_from_storage, is_document_indexed
from app.rag.vector_store import collection_exists

logger = logging.getLogger(__name__)


async def check_and_index_storage_files() -> int:
    """
    Check all files in Supabase Storage and index any that haven't been indexed yet.
    
    Returns:
        int: Number of documents indexed
    """
    # Check if Qdrant collection exists
    if not collection_exists():
        logger.warning("Qdrant collection does not exist. Skipping indexing check.")
        return 0
    
    # List all files in storage
    try:
        storage_files = await list_storage_files()
        logger.info(f"Found {len(storage_files)} files in storage")
    except Exception as e:
        logger.error(f"Error listing storage files: {e}")
        return 0
    
    if not storage_files:
        logger.info("No files found in storage")
        return 0
    
    indexed_count = 0
    skipped_count = 0
    error_count = 0
    
    for file_path in storage_files:
        try:
            # Check if document is already indexed
            if await is_document_indexed(file_path):
                logger.debug(f"Document already indexed: {file_path}")
                skipped_count += 1
                continue
            
            # Index the document
            logger.info(f"Indexing document: {file_path}")
            await index_document_from_storage(file_path, metadata={"file_path": file_path, "filename": file_path})
            indexed_count += 1
            logger.info(f"Successfully indexed: {file_path}")
            
        except Exception as e:
            logger.error(f"Error indexing document {file_path}: {e}")
            error_count += 1
    
    logger.info(
        f"Indexing check complete. "
        f"Indexed: {indexed_count}, "
        f"Already indexed: {skipped_count}, "
        f"Errors: {error_count}"
    )
    
    return indexed_count


async def run_periodic_indexer(interval_hours: int = 1):
    """
    Run the periodic indexing worker that checks storage every hour.
    
    Args:
        interval_hours: Hours to wait between checks (default: 1 hour)
    """
    interval_seconds = interval_hours * 3600
    
    logger.info(f"Periodic indexer started. Checking every {interval_hours} hour(s) ({interval_seconds} seconds)")
    
    # Run immediately on startup
    await check_and_index_storage_files()
    
    # Then run periodically
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            await check_and_index_storage_files()
        except asyncio.CancelledError:
            logger.info("Periodic indexer cancelled")
            break
        except Exception as e:
            logger.error(f"Periodic indexer error: {e}")
            # Continue running even if there's an error
            await asyncio.sleep(60)  # Wait 1 minute before retrying on error


# Legacy function for backward compatibility
async def process_pending_documents(limit: int = 10) -> int:
    """
    Legacy function - redirects to check_and_index_storage_files.
    Kept for backward compatibility.
    """
    return await check_and_index_storage_files()


async def run_worker(interval_seconds: int = 3600):
    """
    Run the indexing worker in a loop (legacy function).
    
    Args:
        interval_seconds: Seconds to wait between processing cycles (default: 3600 = 1 hour)
    """
    interval_hours = interval_seconds / 3600
    await run_periodic_indexer(interval_hours=interval_hours)


if __name__ == "__main__":
    # Run worker
    asyncio.run(run_worker())

