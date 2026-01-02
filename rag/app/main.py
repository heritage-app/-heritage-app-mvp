"""
FastAPI application entrypoint.
Provides document upload and chat endpoints.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.rag.indexer import initial_index_if_needed
from app.api.routes import router
from app.workers.index_worker import run_periodic_indexer
from app.core.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    # Try to initialize Qdrant collection if it doesn't exist (non-blocking)
    # If Qdrant is not running, this will just log a warning
    try:
        initial_index_if_needed()
    except Exception:
        # Qdrant not available - continue startup anyway
        pass
    
    # Start periodic indexer task (runs every hour)
    indexer_task = None
    try:
        indexer_task = asyncio.create_task(run_periodic_indexer(interval_hours=1))
        logger.info("Periodic indexer task started")
    except Exception as e:
        logger.warning(f"Failed to start periodic indexer: {e}")
    
    yield
    
    # Shutdown
    # Cancel the periodic indexer task
    if indexer_task:
        indexer_task.cancel()
        try:
            await indexer_task
        except asyncio.CancelledError:
            logger.info("Periodic indexer task cancelled")
    
    # Note: CancelledError during shutdown when stopping server (Ctrl+C) is normal
    # Resources (Supabase client, etc.) clean up automatically


app = FastAPI(
    title="Heritage RAG System",
    description="Production-ready RAG system using LlamaIndex, LangChain, Qdrant, Supabase, and OpenRouter",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
# Note: When allow_credentials=True, you cannot use allow_origins=["*"]
# Must specify exact origins
try:
    cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    if not cors_origins:
        # Fallback to default if empty
        cors_origins = ["https://heritage.ekowlabs.space", "http://localhost:3000", "http://localhost:5173", "http://localhost:8080"]
except Exception as e:
    logger.warning(f"Error parsing CORS origins, using defaults: {e}")
    cors_origins = ["https://heritage.ekowlabs.space", "http://localhost:3000", "http://localhost:5173", "http://localhost:8080"]

logger.info(f"CORS origins configured: {cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # Cache preflight requests for 1 hour
)

# Include API routes
app.include_router(router)
