-- Context for a word or phrase, added by people from the chat ("Add context")
-- or the Contribute form, and approved by an admin in the Review queue. Kept
-- apart from vocabulary: it never creates or changes a dictionary entry. A word
-- can have context from several people. Shown under the word's answer in chat.
CREATE TABLE IF NOT EXISTS word_context (
  id               TEXT PRIMARY KEY,
  ga               TEXT NOT NULL,      -- the word as shown in the answer
  ga_key           TEXT NOT NULL,      -- voiceKey(ga): spelling-tolerant, keeps the nasal mark
  english          TEXT,
  context          TEXT,               -- when / how it's said
  example_ga       TEXT,               -- the word in a sentence
  example_en       TEXT,
  contributor_id   TEXT,
  contributor_name TEXT,               -- credit shown with it
  contribution_id  TEXT,
  approved_by      TEXT,
  approved_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_word_context_key ON word_context(ga_key);
