# Heritage RAG — Cloudflare Workers

A full port of the FastAPI **Heritage RAG** system (a Ga-language assistant with a
"Nii Obodai" persona, Bible + general modes, Ga numerics, and admin document
management) to a **pure Cloudflare** stack.

## Stack mapping (Python → Cloudflare)

| Original (FastAPI)            | Cloudflare                                   |
| ---------------------------- | -------------------------------------------- |
| FastAPI                      | Cloudflare Workers + **Hono**                |
| Qdrant (3 collections)       | **Vectorize** (1 index, `category` metadata) |
| HuggingFace embeddings       | **Workers AI** `@cf/baai/bge-base-en-v1.5` (768d) |
| OpenRouter / Gemini LLM      | **Workers AI** `@cf/meta/llama-3.1-8b-instruct` |
| Supabase Storage             | **R2** (`heritage-documents` bucket)         |
| MongoDB / Postgres           | **D1** (`heritage-db`)                        |
| bcrypt + PyJWT cookie auth   | WebCrypto PBKDF2 + `hono/jwt` cookie auth    |

## Layout

```
src/
├── index.ts            # Hono entry, CORS, route mounting, super-admin bootstrap
├── types.ts            # Env bindings + row/record types
├── config.ts           # constants, category mapping, book map
├── bootstrap.ts        # idempotent super-admin provisioning
├── auth/               # password (PBKDF2), jwt, middleware
├── db/                 # D1 repos: users, sessions, messages, documents, bibleVerses
├── rag/
│   ├── ga.ts           # Ga numerics + citation resolution
│   ├── prompts.ts      # guardrail + Nii Obodai persona + summarize/title
│   ├── validator.ts    # bible record validators + deterministic quote formatter
│   ├── embeddings.ts   # Workers AI embeddings
│   ├── llm.ts          # Workers AI chat (blocking + token streaming)
│   ├── retriever.ts    # Vectorize query + context formatting
│   ├── refiner.ts      # BibleRefiner (extraction → verse records)
│   ├── indexer.ts      # extract → classify → chunk → embed → upsert
│   ├── discovery.ts    # chapter/verse listing (from D1)
│   ├── memory.ts       # conversation context, summary, title
│   └── service.ts      # ask / askBible / askGeneral + routing + persistence
├── routes/             # auth, user, chat, conversations, admin, meta
└── utils/time.ts       # humanize timestamp, slugify, file size
```

## One-time setup

```bash
npm install

# 1. D1 database
wrangler d1 create heritage-db
#   -> paste the returned database_id into wrangler.toml ([[d1_databases]])
npm run db:schema:remote          # apply schema.sql (use :local for local dev)

# 2. Vectorize index (768 dims, cosine) + metadata indexes for filtering
wrangler vectorize create heritage-index --dimensions=768 --metric=cosine
wrangler vectorize create-metadata-index heritage-index --property-name=category --type=string
wrangler vectorize create-metadata-index heritage-index --property-name=book --type=string
wrangler vectorize create-metadata-index heritage-index --property-name=chapter_num --type=number
wrangler vectorize create-metadata-index heritage-index --property-name=verse_num --type=number

# 3. R2 bucket
wrangler r2 bucket create heritage-documents

# 4. Secrets
cp .dev.vars.example .dev.vars     # local: set JWT_SECRET (+ optional SUPER_ADMIN_PASSWORD)
wrangler secret put JWT_SECRET     # production
```

To auto-provision an admin on boot, set `SUPER_ADMIN_EMAIL` in `wrangler.toml`
and `SUPER_ADMIN_PASSWORD` as a secret.

## Run

```bash
npm run dev        # local dev (http://localhost:8787)
npm run deploy     # publish to Cloudflare
npm run typecheck  # tsc --noEmit
```

## API (all under `/api/v1`)

| Method | Path                                   | Auth   | Notes |
| ------ | -------------------------------------- | ------ | ----- |
| GET    | `/`                                    | —      | API info |
| GET    | `/health`                              | —      | D1 + Vectorize check |
| POST   | `/auth/signup` · `/auth/login`         | —      | sets HttpOnly cookie |
| POST   | `/auth/logout`                         | —      | |
| GET    | `/auth/me`                             | user   | |
| GET/PATCH | `/user/me`                          | user   | profile |
| POST   | `/chat/new`                            | user/guest | `?stream=true` streams text/plain |
| POST   | `/chat/:conversation_id`               | user/guest | continue a conversation |
| POST   | `/bible/ask` · `/general/ask`          | user/guest | explicit mode |
| GET    | `/conversations`                       | user   | recent sessions |
| GET    | `/conversations/:id/messages`          | user   | full transcript |
| POST   | `/admin/upload`                        | admin  | multipart; background indexing |
| GET    | `/admin/documents`                     | admin  | |
| DELETE | `/admin/documents/:id`                 | admin  | removes D1 + R2 + vectors |
| POST   | `/admin/refine/preview` · `/refine/commit` | admin | Bible refinement |
| GET    | `/admin/users`                         | admin  | |
| PATCH  | `/admin/users/:id/role?role=admin`     | admin  | |
| GET    | `/admin/stats`                         | admin  | |

Guests send an `X-Anonymous-ID` header; logged-in users authenticate via the
`access_token` cookie (or `Authorization: Bearer`).

### Examples

```bash
# Signup (stores cookie)
curl -c jar.txt -X POST localhost:8787/api/v1/auth/signup \
  -H 'Content-Type: application/json' -d '{"email":"me@x.com","password":"secret"}'

# Stream an answer
curl -b jar.txt -N -X POST 'localhost:8787/api/v1/chat/new?stream=true' \
  -H 'Content-Type: application/json' -d '{"query":"Genesis 1:1","mode":"bible"}'

# Admin upload a JSONL bible/heritage file
curl -b jar.txt -X POST localhost:8787/api/v1/admin/upload \
  -F 'file=@verses.jsonl' -F 'metadata={"category":"bible"}'
```

## Notes & differences from the Python version

- **Single Vectorize index** replaces three Qdrant collections; the `category`
  metadata tag (`bible` / `stories` / `heritage`) + metadata indexes reproduce the
  same filtering and per-collection retrieval.
- **Bible verses are mirrored into D1** (`bible_verses`) so exact-verse lookups and
  chapter/verse discovery are deterministic — Vectorize has no `scroll`/scan.
- **Document parsing**: `txt/md/json/jsonl` natively; **PDF** via `unpdf`.
  PyMuPDF/python-docx have no Workers equivalent, so DOCX is read as plain text.
- **Indexing runs in the background** (`ctx.waitUntil`). Very large files may hit
  Worker CPU/subrequest limits; chunk big corpora into multiple uploads or move
  indexing to a Queue consumer for production scale.
- **Vector deletion** relies on `vector_ids` stored on the document row at index
  time (Vectorize has no delete-by-filter).
- **No LLM response cache** layer yet (the Python in-memory cache didn't translate
  to the stateless Worker model); add Workers KV if you want one.
