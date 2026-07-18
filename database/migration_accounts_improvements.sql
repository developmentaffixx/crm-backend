-- ============================================================
-- Accounts Module Improvements - Migration
-- SAFE: Only updates display-field project_id_code (not a FK anywhere)
-- ============================================================

USE crm_task_module;

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA MIGRATION: Convert existing PRJ-xxx-### codes to ACC-YYMMDD-###
-- Uses each project's created_at date to generate the YYMMDD portion
-- Sequential numbering resets per Financial Year (April–March)
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Assign new ACC-YYMMDD-### codes to ALL existing projects
-- We use a session variable to generate sequential numbers ordered by created_at

SET @seq := 0;
SET @prev_fy := '';

UPDATE projects p
JOIN (
  SELECT 
    id,
    created_at,
    DATE_FORMAT(created_at, '%y%m%d') AS date_part,
    -- Determine FY: if month >= 4 (April), FY = that year; else FY = prev year
    CASE 
      WHEN MONTH(created_at) >= 4 THEN YEAR(created_at)
      ELSE YEAR(created_at) - 1
    END AS fy_year,
    @seq := IF(
      @prev_fy = CASE WHEN MONTH(created_at) >= 4 THEN YEAR(created_at) ELSE YEAR(created_at) - 1 END,
      @seq + 1,
      1
    ) AS seq_num,
    @prev_fy := CASE WHEN MONTH(created_at) >= 4 THEN YEAR(created_at) ELSE YEAR(created_at) - 1 END AS fy_track
  FROM projects
  WHERE deleted = 0
  ORDER BY created_at ASC
) AS numbered ON numbered.id = p.id
SET p.project_id_code = CONCAT('ACC-', numbered.date_part, '-', LPAD(numbered.seq_num, 3, '0'));

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTES:
-- ─────────────────────────────────────────────────────────────────────────────
-- 
-- After running this migration:
-- - All existing projects will have codes like: ACC-250415-001, ACC-250420-002, etc.
-- - New projects created by the app will continue with ACC-YYMMDD-### format
-- - The unique index on project_id_code ensures no duplicates
--
-- If you need to VERIFY before running:
-- SELECT id, project_id_code, created_at FROM projects WHERE deleted = 0 ORDER BY created_at;
--
-- If you need to ROLLBACK (restore old codes):
-- This is one-way. Keep a backup of the old codes if needed:
-- SELECT id, project_id_code FROM projects WHERE deleted = 0;
-- (Save this result before running the UPDATE)
