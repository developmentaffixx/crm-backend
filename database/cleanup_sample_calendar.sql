USE crm_task_module;

-- ============================================================
-- CLEANUP SAMPLE CONTENT CALENDAR DATA - Affixx Media (August 2026)
-- This removes all sample data inserted by seed_sample_calendar.sql
--
-- Safe: Uses plan_month + client_id + project_id to target only the sample plan.
-- Child rows (posts, shoots, ads) auto-delete via CASCADE.
-- ============================================================

-- Delete the August 2026 plan for Affixx Media (project_id=1, client_id=106)
-- CASCADE will automatically remove all child posts, shoots, and ads

DELETE FROM content_calendar_plans
WHERE client_id IN (34, 106)
  AND project_id = 1
  AND plan_month = '2026-08-01'
  AND primary_goal LIKE '%Increase brand awareness & generate leads%';

-- Verify cleanup
SELECT 'Cleanup complete. Remaining plans for this client:' AS status;
SELECT id, plan_month, status FROM content_calendar_plans WHERE client_id = 106 AND project_id = 1;
