USE crm_task_module;

-- ============================================================
-- FIX: Revert wrong change & correctly link portal user to Affixx Media
--
-- Problem: Portal user (developmentaffixx@gmail.com) had client_id=34 (Swagath)
-- but it should be client_id=106 (Affixx Media / AFXCL007 / Ramachandirane)
-- 
-- The previous run wrongly set the plan's client_id to 34. This reverts that
-- and fixes the portal user to point to the correct client.
-- ============================================================

-- Step 1: Revert the plan's client_id back to 106 (Affixx Media)
UPDATE content_calendar_plans 
SET client_id = 106 
WHERE project_id = 1 
  AND plan_month = '2026-08-01' 
  AND primary_goal LIKE '%Increase brand awareness%';

-- Step 2: Fix the portal user — point to correct client (Affixx Media = 106)
UPDATE client_portal_users 
SET client_id = 106 
WHERE login_email = 'developmentaffixx@gmail.com';

-- Step 3: Ensure content_calendar_access is enabled
UPDATE client_portal_users 
SET content_calendar_access = 1 
WHERE client_id = 106;

-- Verify
SELECT 'Portal user:' AS info;
SELECT id, client_id, login_email, content_calendar_access 
FROM client_portal_users 
WHERE login_email = 'developmentaffixx@gmail.com';

SELECT 'Plan:' AS info;
SELECT id, client_id, project_id, plan_month, shared_with_client, status 
FROM content_calendar_plans 
WHERE plan_month = '2026-08-01' AND project_id = 1;
