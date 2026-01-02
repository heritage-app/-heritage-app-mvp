-- Supabase Database Schema for Heritage RAG System
-- Run these SQL queries in your Supabase SQL Editor

-- ============================================
-- 1. Messages Table
-- Stores chat conversation messages
-- ============================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    title TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- ============================================
-- 2. Conversation Summaries Table
-- Stores LLM-generated summaries of conversations
-- ============================================

CREATE TABLE IF NOT EXISTS conversation_summaries (
    conversation_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    title TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_updated_at ON conversation_summaries(updated_at DESC);

-- ============================================
-- 3. Enable Row Level Security (Optional)
-- Uncomment if you want to add RLS policies later
-- ============================================

-- ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Example RLS Policies (Optional - for future use)
-- ============================================

-- Example: Allow all operations (adjust based on your auth needs)
-- CREATE POLICY "Allow all operations on messages" ON messages
--     FOR ALL USING (true) WITH CHECK (true);

-- CREATE POLICY "Allow all operations on conversation_summaries" ON conversation_summaries
--     FOR ALL USING (true) WITH CHECK (true);

