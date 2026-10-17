-- Account status: 'active' (default) or 'suspended' — suspended accounts
-- can't sign in and their tokens stop working at the next request.
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-users-status.sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
