-- Invite links: an admin mints a role-bearing link; accepting it signs the
-- person up with that role. Admin invites land on the admin console's auth
-- page, member invites on the app's. Single-use, expiring.
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-invites.sql
CREATE TABLE IF NOT EXISTS invites (
  token      TEXT PRIMARY KEY,
  role       TEXT NOT NULL,       -- admin | member | moderator | user
  email      TEXT,                -- NULL = anyone with the link; set = locked to this address
  invited_by TEXT NOT NULL,       -- admin user id
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  used_by    TEXT                 -- user id of the account it created
);
CREATE INDEX IF NOT EXISTS idx_invites_pending ON invites(used_at, expires_at);
