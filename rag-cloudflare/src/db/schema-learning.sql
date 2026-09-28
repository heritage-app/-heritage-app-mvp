-- Schema updates for the closed-loop learning system.
-- Run with: wrangler d1 execute heritage-db --remote --file=./src/db/schema-learning.sql
-- (or --local for local dev)

-- Track who approved/rejected a contribution and when.
ALTER TABLE user_contributions ADD COLUMN contributor_id TEXT;
CREATE INDEX IF NOT EXISTS idx_user_contributions_contributor
  ON user_contributions(contributor_id);

-- Index for finding staged (unverified) corrections to tier-promote.
CREATE INDEX IF NOT EXISTS idx_vocabulary_staged
  ON vocabulary(source, verified_at);

-- Index for feedback joined to interactions (used by admin insights).
CREATE INDEX IF NOT EXISTS idx_response_feedback_user
  ON response_feedback(user_id, created_at DESC);
