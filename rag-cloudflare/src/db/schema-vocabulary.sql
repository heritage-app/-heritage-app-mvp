-- Verified Ga vocabulary store (accuracy-critical; see GA_ACCURACY_AUDIT.md).
--
-- Integrity rule: a row is retrievable ONLY if `source` AND `verified_at` are
-- both non-empty. The retrieval layer (src/db/vocabulary.ts) enforces this, so
-- an unverified or partially-imported row can never surface in suggestions.
--
-- Arrays (meanings/translations/examples/variants) are stored as JSON text —
-- D1 is SQLite. `headword_normalized` is diacritic/ASCII-folded for matching
-- only and is NEVER displayed; the canonical `headword` is always shown.

CREATE TABLE IF NOT EXISTS vocabulary (
  id                  TEXT PRIMARY KEY,
  headword            TEXT NOT NULL,              -- canonical Ga spelling (ɛ ɔ ŋ, tone marks)
  headword_normalized TEXT NOT NULL,              -- folded, lowercase — matching only
  part_of_speech      TEXT,
  meanings            TEXT NOT NULL DEFAULT '[]', -- JSON array of verified definitions
  translations        TEXT NOT NULL DEFAULT '[]', -- JSON array of verified English equivalents
  examples            TEXT NOT NULL DEFAULT '[]', -- JSON array (optional)
  variants            TEXT NOT NULL DEFAULT '[]', -- JSON array of accepted alternate spellings
  phonetic            TEXT,                        -- display pronunciation aid
  category            TEXT,                        -- number|bible|phrase|greeting|book
  source              TEXT,                        -- citation; REQUIRED for retrieval
  verified_by         TEXT,                        -- reviewer / import process
  verified_at         TEXT                         -- ISO timestamp; REQUIRED for retrieval
);

CREATE INDEX IF NOT EXISTS idx_vocab_normalized ON vocabulary(headword_normalized);
CREATE INDEX IF NOT EXISTS idx_vocab_category   ON vocabulary(category);
