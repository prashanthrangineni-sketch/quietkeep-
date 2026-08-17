-- supabase/migrations/20260817_add_scheduled_for_to_execution_queue.sql
-- Add scheduled_for column to execution_queue and index it for fast pending lookups.

ALTER TABLE execution_queue ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
CREATE INDEX IF NOT EXISTS idx_execution_queue_scheduled_for ON execution_queue (scheduled_for) WHERE status = 'pending';
