-- Fix database schema if conversation_id is UUID instead of TEXT
-- Run this in Supabase SQL Editor if you're getting UUID errors

-- Check current schema
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'messages' AND column_name = 'conversation_id';

-- If conversation_id is UUID, convert it to TEXT
-- First, back up your data (export if needed)

-- Step 1: Add a temporary TEXT column
ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id_temp TEXT;

-- Step 2: Copy UUID values as strings to the temp column
UPDATE messages SET conversation_id_temp = conversation_id::TEXT;

-- Step 3: Drop the old UUID column
ALTER TABLE messages DROP COLUMN conversation_id;

-- Step 4: Rename the temp column to conversation_id
ALTER TABLE messages RENAME COLUMN conversation_id_temp TO conversation_id;

-- Step 5: Add back NOT NULL constraint
ALTER TABLE messages ALTER COLUMN conversation_id SET NOT NULL;

-- Step 6: Recreate the index
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Also check conversation_summaries table
-- If conversation_summaries.conversation_id is UUID, do the same:

-- Step 1: Add temporary column
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS conversation_id_temp TEXT;

-- Step 2: Copy values
UPDATE conversation_summaries SET conversation_id_temp = conversation_id::TEXT;

-- Step 3: Drop old column and primary key constraint first
ALTER TABLE conversation_summaries DROP CONSTRAINT IF EXISTS conversation_summaries_pkey;
ALTER TABLE conversation_summaries DROP COLUMN conversation_id;

-- Step 4: Rename temp column
ALTER TABLE conversation_summaries RENAME COLUMN conversation_id_temp TO conversation_id;

-- Step 5: Add primary key back
ALTER TABLE conversation_summaries ADD PRIMARY KEY (conversation_id);

-- Verify the schema matches
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('messages', 'conversation_summaries')
    AND column_name = 'conversation_id'
ORDER BY table_name, column_name;


