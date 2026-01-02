# Heritage RAG System

Production-ready Retrieval-Augmented Generation (RAG) system built with LlamaIndex, LangChain, Qdrant, Supabase, and OpenRouter.

## Quick Start

```bash
# 1. Install dependencies
pip install uv
uv sync

# 2. Configure environment
cp env.example .env
# Edit .env with your credentials

# 3. Start Qdrant
docker run -p 6333:6333 qdrant/qdrant

# 4. Set up Supabase (see Database Setup below)

# 5. Run the API
uv run uvicorn app.main:app --reload
```

## Architecture Overview

```
Document Upload        → Supabase Storage
Chat History           → Supabase Database (Postgres)
Memory Window          → FastAPI (in-memory, last N messages)
Conversation Summary   → Supabase DB (LLM-generated)
Document Processing    → LlamaIndex (chunking)
Embeddings             → HuggingFace (local, free)
Vector Store           → Qdrant
LLM Provider           → OpenRouter
API                    → FastAPI
Background Indexing    → Supabase Triggers + Worker
Streaming Responses    → LangChain + FastAPI
```

## Prerequisites

- Python **3.10+**
- Docker (for Qdrant)
- Supabase project with Storage and Postgres enabled
- OpenRouter API key

## Installation

### 1. Install uv

```bash
pip install uv
uv --version
```

### 2. Configure Environment

Create `.env` from `env.example`:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=meta-llama/llama-3-8b-instruct
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
QDRANT_URL=http://localhost:6333
```

> **Note**: Do NOT set `OPENAI_API_KEY` - this project uses OpenRouter, not OpenAI directly.

### 3. Install Dependencies

```bash
uv sync
```

### 4. Start Qdrant

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Access Qdrant dashboard: http://localhost:6333/dashboard

## Database Setup

### Supabase Tables

**messages table:**
```sql
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

**conversation_summaries table:**
```sql
CREATE TABLE conversation_summaries (
  conversation_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Supabase Storage

- Create a bucket named `documents`
- Configure access policies (public or private as needed)

## Usage

### Start the API

```bash
uv run uvicorn app.main:app --reload
```

API available at: http://localhost:8000

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API information |
| `GET` | `/health` | Health check |
| `POST` | `/upload` | Upload and index document |
| `POST` | `/ask` | Ask a question (streaming) |

### Examples

**Upload a document:**
```bash
curl -X POST "http://localhost:8000/upload" \
  -F "file=@your_document.pdf"
```

**Ask a question (streaming):**
```bash
curl -X POST "http://localhost:8000/ask" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is this document about?",
    "conversation_id": "unique-id-123"
  }'
```

**Ask without streaming:**
```bash
curl -X POST "http://localhost:8000/ask" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is this document about?",
    "conversation_id": "unique-id-123",
    "stream": false
  }'
```

## Background Worker

Run the indexing worker for background document processing:

```bash
uv run python app/workers/index_worker.py
```

Configure to trigger via Supabase webhooks or run as a scheduled task.

## Project Structure

```
app/
├── main.py                    # FastAPI entrypoint
├── api/
│   └── routes.py              # API routes
├── core/
│   └── config.py              # Configuration
├── rag/
│   ├── embeddings.py          # HuggingFace embeddings
│   ├── vector_store.py        # Qdrant + LlamaIndex
│   ├── indexer.py             # Document indexing
│   ├── retriever.py           # LlamaIndex retriever
│   ├── llm.py                 # OpenRouter LLM
│   ├── memory.py              # Memory & summarization
│   └── service.py             # RAG orchestration
├── storage/
│   └── supabase.py            # Supabase client
├── workers/
│   └── index_worker.py        # Background worker
└── schemas/
    ├── requests.py            # Request schemas
    └── responses.py           # Response schemas
```

## Features

- ✅ **Modular Architecture** - Clean separation of concerns
- ✅ **Efficient Indexing** - One-time indexing with persistent storage
- ✅ **Memory Management** - Conversation summaries + memory window
- ✅ **Streaming Responses** - Real-time token streaming
- ✅ **Cost-Efficient** - Local embeddings, flexible LLM provider
- ✅ **Scalable** - Background workers, async processing

## Development Guidelines

### Do's ✅

- Always use `uv` for dependency management
- Run commands via `uv run`
- Ensure Qdrant is running before starting the API

### Don'ts ❌

- Do NOT use `pip install` directly
- Do NOT activate virtualenv manually
- Do NOT set `OPENAI_API_KEY`

## How It Works

1. **Indexing**: Documents are indexed once when collection doesn't exist
2. **New Documents**: Trigger background re-indexing
3. **Chat Requests**: No indexing happens during queries
4. **Persistence**: All messages saved to Supabase
5. **Summarization**: Conversation summaries generated automatically
