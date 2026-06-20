-- Heritage RAG — D1 schema
-- Run with: npm run db:schema:local   (or :remote)

-- Users (replaces MongoDB `users`)
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  hashed_password TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',
  display_name    TEXT,
  first_name      TEXT,
  last_name       TEXT,
  dob             TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Chat sessions (replaces MongoDB `chat_sessions`)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT,
  summary     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id, updated_at DESC);

-- Interactions = one turn (query + response). Replaces MongoDB `interactions`/`guest_interactions`.
-- Guests are identified by a `guest_` prefix on user_id; is_guest flag aids stats + cleanup.
CREATE TABLE IF NOT EXISTS interactions (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id         TEXT,
  is_guest        INTEGER NOT NULL DEFAULT 0,
  query           TEXT NOT NULL,
  response        TEXT NOT NULL,
  metadata        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_conv ON interactions(conversation_id, created_at ASC);

-- Documents (replaces MongoDB `documents`)
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  unique_path       TEXT NOT NULL,
  public_url        TEXT,
  category          TEXT,
  metadata          TEXT,
  status            TEXT NOT NULL DEFAULT 'uploading',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);

-- Bible verses: structural store backing deterministic exact-lookup + chapter/verse discovery.
-- Mirrors the records that are also embedded into Vectorize.
CREATE TABLE IF NOT EXISTS bible_verses (
  id                    TEXT PRIMARY KEY,  -- bible:<book>:<chapter>:<verse>
  book                  TEXT NOT NULL,
  traditional_book      TEXT,
  chapter_num           INTEGER NOT NULL,
  chapter_title_ga      TEXT,
  chapter_title_en      TEXT,
  verse_num             INTEGER NOT NULL,
  verse_ref             TEXT,
  ga_verse_label        TEXT,
  reference_display     TEXT,
  ga                    TEXT,
  en                    TEXT,
  ga_version_name       TEXT,
  ga_version_abbr       TEXT,
  english_version_name  TEXT,
  english_version_abbr  TEXT,
  source_name           TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verses_lookup ON bible_verses(book, chapter_num, verse_num);
