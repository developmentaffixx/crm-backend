USE crm_task_module;

-- ============================================================
-- FIX: Update the sample calendar plan's client_id to match
-- the client portal user's client_id (34)
--
-- Problem: Portal user (developmentaffixx@gmail.com) has client_id=34
-- but the seeded plan was created with client_id=106 (project's client)
-- The clientViewCalendar endpoint filters by the portal user's client_id
-- ============================================================

-- Also ensure content_calendar_access is enabled for this portal user
UPDATE client_portal_users 
SET content_calendar_access = 1 
WHERE client_id = 34;

-- Update the plan to use client_id = 34 so it shows in portal
UPDATE content_calendar_plans 
SET client_id = 34 
WHERE project_id = 1 
  AND plan_month = '2026-08-01' 
  AND primary_goal LIKE '%Increase brand awareness%';

-- Verify
SELECT id, client_id, project_id, plan_month, shared_with_client, status 
FROM content_calendar_plans 
WHERE plan_month = '2026-08-01' AND project_id = 1;
