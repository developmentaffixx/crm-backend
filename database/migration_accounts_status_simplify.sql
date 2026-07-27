-- ============================================================
-- Accounts Status Simplification - Migration
-- Changes status from ENUM('open','in_progress','completed','cancelled')
-- to ENUM('active','inactive')
-- ============================================================

USE crm_task_module;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Migrate existing data to new values
-- open / in_progress → active
-- completed / cancelled → inactive
-- ─────────────────────────────────────────────────────────────────────────────

-- First, temporarily change the ENUM to include all old + new values
ALTER TABLE projects 
  MODIFY COLUMN status ENUM('open','in_progress','completed','cancelled','active','inactive') NOT NULL DEFAULT 'active';

-- Map old values to new values
UPDATE projects SET status = 'active' WHERE status IN ('open', 'in_progress');
UPDATE projects SET status = 'inactive' WHERE status IN ('completed', 'cancelled');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Now restrict ENUM to only the new values
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects 
  MODIFY COLUMN status ENUM('active','inactive') NOT NULL DEFAULT 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTES:
-- ─────────────────────────────────────────────────────────────────────────────
-- 
-- After running this migration:
-- - All accounts will have status 'active' or 'inactive'
-- - Default for new accounts is 'active'
-- - Old statuses (open, in_progress, completed, cancelled) are no longer valid
--
-- ROLLBACK (if needed):
-- ALTER TABLE projects MODIFY COLUMN status ENUM('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open';
-- (Note: You would lose the mapping back to original statuses)
