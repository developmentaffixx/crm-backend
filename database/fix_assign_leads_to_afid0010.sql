-- ============================================================
-- Fix: Assign all unassigned leads to AFID0010
-- Run this once to bulk-assign leads with NULL assigned_to
-- ============================================================

USE crm_task_module;

-- First, check which leads are unassigned
SELECT id, lead_id, name, business_name, assigned_to
FROM leads
WHERE assigned_to IS NULL AND deleted = 0;

-- Assign all unassigned leads to AFID0010
UPDATE leads
SET assigned_to = (SELECT id FROM users WHERE emp_code = 'AFID0010' AND deleted = 0 LIMIT 1),
    updated_at = NOW()
WHERE assigned_to IS NULL AND deleted = 0;

-- Verify the update
SELECT COUNT(*) AS updated_count FROM leads
WHERE assigned_to = (SELECT id FROM users WHERE emp_code = 'AFID0010' AND deleted = 0 LIMIT 1)
  AND deleted = 0;
