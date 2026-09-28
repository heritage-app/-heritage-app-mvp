-- Word alignments: English↔Ga word pairs inferred from sentence-pair
-- co-occurrence across the heritage archive. Status lifecycle:
--   inferred  → computed by /admin/alignments/build, not verified
--   promoted  → admin approved; a verified vocabulary row was created
--   rejected  → admin rejected; never surfaced again
CREATE TABLE IF NOT EXISTS word_alignments (
  id             TEXT PRIMARY KEY,          -- wa:<english_normalized>:<ga_normalized>
  english_word   TEXT NOT NULL,             -- display form
  ga_word        TEXT NOT NULL,             -- display form (canonical Ga spelling)
  english_normalized TEXT NOT NULL,         -- folded, lowercase — matching only
  ga_normalized      TEXT NOT NULL,
  confidence     REAL NOT NULL,             -- Dice coefficient 0..1
  evidence_count INTEGER NOT NULL,          -- sentence pairs containing both words
  examples       TEXT NOT NULL DEFAULT '[]',-- JSON [{english, ga}] source pairs
  status         TEXT NOT NULL DEFAULT 'inferred',
  source         TEXT NOT NULL DEFAULT 'corpus-alignment',
  reviewed_by    TEXT,
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_align_english ON word_alignments(english_normalized);
CREATE INDEX IF NOT EXISTS idx_align_ga      ON word_alignments(ga_normalized);
CREATE INDEX IF NOT EXISTS idx_align_status  ON word_alignments(status, confidence DESC);
