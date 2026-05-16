USE crm_task_module;

-- ─── Add all new module slugs to role_permissions for existing roles ──────────
-- Run this after migration_settings.sql if you already have roles seeded.
-- Uses INSERT IGNORE so it won't duplicate existing rows.

SET @modules = 'dashboard,projects,tasks,tickets,creative_hub,people_ops,clients,revenue,finance,playbook,reports,settings';

-- For each existing role, seed zero permissions for any missing module
INSERT IGNORE INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
SELECT r.id, m.module, 0, 0, 0, 0
FROM roles r
JOIN (
  SELECT 'dashboard'    AS module UNION ALL
  SELECT 'projects'               UNION ALL
  SELECT 'tasks'                  UNION ALL
  SELECT 'tickets'                UNION ALL
  SELECT 'creative_hub'           UNION ALL
  SELECT 'people_ops'             UNION ALL
  SELECT 'clients'                UNION ALL
  SELECT 'revenue'                UNION ALL
  SELECT 'finance'                UNION ALL
  SELECT 'playbook'               UNION ALL
  SELECT 'reports'                UNION ALL
  SELECT 'settings'
) m ON 1=1;

-- ─── Update createRole in backend to seed all 12 modules ─────────────────────
-- (The backend controller also needs updating — see settings.controller.js)
