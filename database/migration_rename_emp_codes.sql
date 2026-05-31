-- ============================================================
-- Migration: Rename EMP### / AFAD### codes to new format
--   Admin (is_admin = 1)  →  DOUBT  (fixed, single admin)
--   Team  (is_admin = 0)  →  AFID### (e.g. AFID001)
-- Run this ONCE on the live database before deploying updated code.
-- Safe to run: only affects rows where emp_code starts with 'EMP' or 'AFAD'
-- ============================================================

USE crm_task_module;

-- Step 1: Set admin emp_code to DOUBT
UPDATE users
SET emp_code = 'DOUBT'
WHERE is_admin = 1;

-- Step 2: Rename team members  →  EMP002 / AFAD002 becomes AFID002
UPDATE users
SET emp_code = CONCAT('AFID', SUBSTRING(emp_code, 4))
WHERE is_admin = 0
  AND (emp_code LIKE 'EMP%' OR emp_code LIKE 'AFI%' OR emp_code LIKE 'AFA%');

-- Step 3: Verify — admin should show DOUBT, others should show AFID###
SELECT id, emp_code, is_admin, CONCAT(first_name, ' ', last_name) AS name
FROM users
ORDER BY is_admin DESC, id ASC;
