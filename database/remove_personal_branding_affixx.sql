-- ============================================================
-- Remove "Personal Branding" service from account ACC-260601-001
-- ============================================================

USE crm_task_module;

-- Delete the project_services record linking "Personal Branding" to account ACC-260601-001
DELETE ps
FROM project_services ps
JOIN projects p ON ps.project_id = p.id
JOIN services s ON ps.service_id = s.id
WHERE p.project_id_code = 'ACC-260601-001'
  AND s.name = 'Personal Branding';
