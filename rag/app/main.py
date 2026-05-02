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
from app.api.routes import router as legacy_router
from app.api.routers import documents, admin
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
            # Also ensure interaction storage indexes
            from app.storage.providers import Repositories
            msg_repo = await Repositories.messages()
            await msg_repo.ensure_ttl_indexes()
            logger.info("Database TTL indexes ensured")
        except Exception as e:
            logger.warning(f"Error during startup initialization: {e}")

    asyncio.create_task(init_qdrant())
    
    yield
    
    # Shutdown
    # Resources (Supabase client, etc.) clean up automatically


app = FastAPI(
    title="Heritage RAG System",
    description="Production-ready RAG system using LlamaIndex, LangChain, Qdrant, Supabase, and OpenRouter",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False
)

# CORS middleware - restricted to only required methods and headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Anonymous-ID"],
    expose_headers=["X-Conversation-Id"],
    max_age=3600,  # Cache preflight requests for 1 hour
)

# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "Heritage RAG System API is running",
        "version": "1.0.0",
        "documentation": "/docs",
        "status": "healthy"
    }

# Include API routes
app.include_router(legacy_router)
app.include_router(admin.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
