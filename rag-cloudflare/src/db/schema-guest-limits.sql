-- Guests can contribute everything signed-in people can (documents, voice
-- recordings). Uploads from guests are capped per connection per day; the
-- connection is kept only as a salted hash, never the address itself.
CREATE TABLE IF NOT EXISTS guest_limits (
  ip_hash TEXT NOT NULL,
  kind    TEXT NOT NULL,   -- 'voice' | 'files'
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_limits ON guest_limits(ip_hash, kind, at);

-- A guest has no account to manage their recordings from, so each one gets a
-- private delete key kept on their device; only its hash is stored here.
-- Run once on an existing database:
--   ALTER TABLE voice_recordings ADD COLUMN owner_token_hash TEXT;
--   ALTER TABLE voice_recordings ADD COLUMN guest_contact TEXT;   -- guest name · email · location, for the reviewer
