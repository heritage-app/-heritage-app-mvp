-- Invites round two: a link can be redeemed up to max_uses times (default 3),
-- not just once. use_count ticks up per sign-up; the link dies when it hits
-- max_uses. Old single-use invites that were already redeemed get max_uses=1
-- so they stay used up.
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-invites-2.sql
ALTER TABLE invites ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 3;
ALTER TABLE invites ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
UPDATE invites SET max_uses = 1, use_count = 1 WHERE used_at IS NOT NULL;
