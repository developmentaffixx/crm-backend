-- ============================================================
-- Debug: Find the missing 10 tasks
-- Run this in phpMyAdmin or any MySQL client against crm_task_module
-- ============================================================

-- STEP 1: Full breakdown — run this first to see where each task falls
SELECT 
  'Total in DB (not soft-deleted)'              AS category, COUNT(*) AS count FROM tasks WHERE deleted = 0
UNION ALL
SELECT 'Visible in Tasks page (no cycle block)', COUNT(*) FROM tasks t WHERE t.deleted = 0
  AND NOT EXISTS (
    SELECT 1 FROM cycle_tasks ct
    JOIN service_cycles sc ON sc.id = ct.cycle_id
    WHERE ct.task_id = t.id AND sc.status IN ('paused','skipped','completed')
  )
UNION ALL
SELECT 'Hidden: paused/skipped/completed cycle', COUNT(*) FROM tasks t WHERE t.deleted = 0
  AND EXISTS (
    SELECT 1 FROM cycle_tasks ct
    JOIN service_cycles sc ON sc.id = ct.cycle_id
    WHERE ct.task_id = t.id AND sc.status IN ('paused','skipped','completed')
  )
UNION ALL
SELECT 'is_active=0 (pending approval, admin only)', COUNT(*) FROM tasks WHERE deleted = 0 AND is_active = 0
UNION ALL
SELECT 'is_active=4 rejected >8hrs ago (hidden)',    COUNT(*) FROM tasks WHERE deleted = 0 AND is_active = 4
  AND (rejected_at IS NULL OR rejected_at < NOW() - INTERVAL 8 HOUR)
UNION ALL
SELECT 'is_active=4 rejected <8hrs (still visible)', COUNT(*) FROM tasks WHERE deleted = 0 AND is_active = 4
  AND rejected_at IS NOT NULL AND rejected_at >= NOW() - INTERVAL 8 HOUR
UNION ALL
SELECT 'Orphan: not linked to any project',          COUNT(*) FROM tasks t WHERE t.deleted = 0
  AND NOT EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id)
UNION ALL
SELECT 'Soft deleted (deleted=1)',                   COUNT(*) FROM tasks WHERE deleted = 1;


-- ============================================================
-- STEP 2: Show the exact missing tasks — not visible in UI and
--         not accounted for by the paused/completed cycle group
-- ============================================================
SELECT
  t.id,
  t.task_id_code,
  t.title,
  t.status,
  t.is_active,
  t.deleted,
  t.rejected_at,
  t.created_at,
  -- Cycle info
  sc.title        AS cycle_title,
  sc.status       AS cycle_status,
  -- Project info
  pt.project_id,
  -- Why it might be missing
  CASE
    WHEN t.deleted = 1                         THEN 'Soft deleted'
    WHEN t.is_active = 0                       THEN 'Pending approval (is_active=0)'
    WHEN t.is_active = 4
      AND (t.rejected_at IS NULL
           OR t.rejected_at < NOW() - INTERVAL 8 HOUR)
                                               THEN 'Rejected task (expired)'
    WHEN sc.status IN ('paused','skipped','completed')
                                               THEN CONCAT('Cycle ', sc.status, ' → hidden')
    WHEN pt.project_id IS NULL                 THEN 'Orphan: no project link'
    ELSE                                            'Unknown / check manually'
  END AS reason_hidden
FROM tasks t
LEFT JOIN cycle_tasks ct ON ct.task_id = t.id
LEFT JOIN service_cycles sc ON sc.id = ct.cycle_id
LEFT JOIN project_tasks pt ON pt.task_id = t.id
-- Only show tasks NOT visible in the standard UI count (319)
WHERE t.deleted = 0
  AND NOT (
    -- This is exactly what the Tasks page shows
    NOT EXISTS (
      SELECT 1 FROM cycle_tasks ct2
      JOIN service_cycles sc2 ON sc2.id = ct2.cycle_id
      WHERE ct2.task_id = t.id AND sc2.status IN ('paused','skipped','completed')
    )
    AND t.is_active IN (1, 2, 3)
  )
ORDER BY reason_hidden, t.created_at DESC;
