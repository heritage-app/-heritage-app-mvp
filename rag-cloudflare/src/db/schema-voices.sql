-- Community voice recordings: a signed-in speaker says a Ga phrase; other
-- speakers listen and vote; an admin approves it before anyone else hears it.
-- Audio lives in R2: voices-pending/<id>.wav until approved (never public),
-- then media/voices/user/<id>.wav (served by /api/v1/media/*).
CREATE TABLE IF NOT EXISTS voice_recordings (
  id                   TEXT PRIMARY KEY,
  ga                   TEXT NOT NULL,          -- the phrase as the speaker typed it
  ga_key               TEXT NOT NULL,          -- spelling-tolerant key (same as the app's voiceKey)
  english              TEXT,
  contributor_id       TEXT NOT NULL,
  contributor_name     TEXT,                   -- credit shown with the clip
  contribution_id      TEXT,                   -- the text contribution it came with, if any
  r2_key               TEXT NOT NULL,
  secs                 REAL NOT NULL,
  peaks                TEXT NOT NULL,          -- JSON, 32 bars for the waveform
  status               TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | removed
  reject_reason        TEXT,
  consent_text         TEXT NOT NULL,
  consent_at           TEXT NOT NULL,
  votes_right          INTEGER NOT NULL DEFAULT 0,
  votes_wrong          INTEGER NOT NULL DEFAULT 0,
  votes_poor           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  reviewed_at          TEXT,
  reviewed_by          TEXT
);
CREATE INDEX IF NOT EXISTS idx_voice_rec_status ON voice_recordings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_rec_key ON voice_recordings(ga_key);
CREATE INDEX IF NOT EXISTS idx_voice_rec_contributor ON voice_recordings(contributor_id);

-- One vote per speaker per recording: right | wrong | poor.
CREATE TABLE IF NOT EXISTS voice_votes (
  recording_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  verdict      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (recording_id, user_id)
);

-- Dataset clips taken down by an admin (a path from src/data/voices.ts).
CREATE TABLE IF NOT EXISTS voice_hidden (
  path       TEXT PRIMARY KEY,
  hidden_by  TEXT,
  hidden_at  TEXT NOT NULL
);

-- The English of a phrase that has a voice. Dataset recordings come with Ga
-- only; an admin adds what it means (shown after Listen & pick, and in admin).
CREATE TABLE IF NOT EXISTS voice_phrases (
  ga_key      TEXT PRIMARY KEY,   -- voiceKey(ga)
  ga          TEXT NOT NULL,
  english     TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);
