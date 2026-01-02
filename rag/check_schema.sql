-- Quick script to check your current database schema
-- Run this in Supabase SQL Editor to see what type conversation_id actually is

SELECT 
    table_name,
    column_name,
    data_type,
    udt_name,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name IN ('messages', 'conversation_summaries')
    AND column_name = 'conversation_id'
ORDER BY table_name, column_name;


