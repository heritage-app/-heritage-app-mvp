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
from app.core.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    # Try to initialize Qdrant collection if it doesn't exist (non-blocking)
    # If Qdrant is not running, this will just log a warning
    async def init_qdrant():
        try:
            initial_index_if_needed()
            logger.info("Qdrant collection check complete")
        except Exception as e:
            logger.warning(f"Qdrant not available or error during initialization: {e}")

    asyncio.create_task(init_qdrant())
    
    yield
    
    # Shutdown
    # Resources (Supabase client, etc.) clean up automatically


app = FastAPI(
    title="Heritage RAG System",
    description="Production-ready RAG system using LlamaIndex, LangChain, Qdrant, Supabase, and OpenRouter",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # Cache preflight requests for 1 hour
)

# Include API routes
app.include_router(router)
