-- Schema updates for learning from knowledge gaps
-- Run these migrations in your D1 database

-- Knowledge gaps table - tracks what users ask for that isn't available
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  query_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  last_seen TEXT,
  frequency INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending', -- pending, user_contributed, prioritized, resolved
  context TEXT,
  suggested_content TEXT,
  user_submitted_answer TEXT,
  category TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_query ON knowledge_gaps(query);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_frequency ON knowledge_gaps(frequency DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_status ON knowledge_gaps(status);

-- User contributions table - stores user-provided answers
CREATE TABLE IF NOT EXISTS user_contributions (
  id TEXT PRIMARY KEY,
  original_query TEXT NOT NULL,
  user_answer TEXT NOT NULL,
  category TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  status TEXT DEFAULT 'pending_review', -- pending_review, approved, rejected
  reviewed_by TEXT,
  reviewed_at TEXT,
  confidence_score REAL
);

CREATE INDEX IF NOT EXISTS idx_user_contributions_status ON user_contributions(status);
CREATE INDEX IF NOT EXISTS idx_user_contributions_category ON user_contributions(category);

-- Learning analytics table
CREATE TABLE IF NOT EXISTS learning_analytics (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  timestamp TEXT NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_analytics_metric ON learning_analytics(metric_name, timestamp);

-- Response feedback table - thumbs up/down on bot responses
CREATE TABLE IF NOT EXISTS response_feedback (
  id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL,
  user_id TEXT,
  rating TEXT NOT NULL,  -- 'helpful' | 'not_helpful'
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_response_feedback_interaction ON response_feedback(interaction_id);
CREATE INDEX IF NOT EXISTS idx_response_feedback_rating ON response_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_response_feedback_created ON response_feedback(created_at);

-- Enhanced user contributions with agreement/conflict tracking
ALTER TABLE user_contributions ADD COLUMN agreement_score REAL DEFAULT 0;
ALTER TABLE user_contributions ADD COLUMN conflict_group_id TEXT;
ALTER TABLE user_contributions ADD COLUMN contribution_count INTEGER DEFAULT 1;
ALTER TABLE user_contributions ADD COLUMN ai_confidence REAL DEFAULT 0;
ALTER TABLE user_contributions ADD COLUMN ai_issues TEXT DEFAULT '[]';