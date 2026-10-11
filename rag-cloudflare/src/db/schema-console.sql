-- Admin console: a log of what admins did (answered, dismissed, reviewed, imported).
-- It is the console's activity log and records which flagged answers were handled.
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-console.sql
CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,       -- answer | send_to_review | dismiss | recheck_resolved | feedback_handled | ...
  ref_kind TEXT NOT NULL,     -- gap | feedback | contribution | document
  ref_id TEXT NOT NULL,
  detail TEXT                 -- short human-readable note
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_ref ON admin_actions(ref_kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_at ON admin_actions(at DESC);
