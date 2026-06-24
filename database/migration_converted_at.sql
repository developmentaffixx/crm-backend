USE crm_task_module;

-- Add converted_at column to leads table
-- This stores the date when a lead was converted to a client (status = 'Won')
-- It should only be set once and never change on subsequent edits.

ALTER TABLE leads ADD COLUMN converted_at DATETIME DEFAULT NULL AFTER updated_at;

-- Backfill: For existing converted clients (status = 'Won'), set converted_at to updated_at as best guess
UPDATE leads SET converted_at = updated_at WHERE status = 'Won' AND converted_at IS NULL;
