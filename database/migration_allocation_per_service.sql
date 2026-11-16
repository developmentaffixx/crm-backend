-- ============================================================
-- Allocation Sheet: one sheet per Project ▸ Service
-- MariaDB syntax. Safe to run more than once.
-- The backend also runs these steps automatically on startup.
-- ============================================================

ALTER TABLE project_allocation_sheets
  ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL AFTER project_id;

-- Add the new unique key first so the project_id foreign key keeps an index
ALTER TABLE project_allocation_sheets
  ADD UNIQUE INDEX IF NOT EXISTS uq_project_service_allocation (project_id, project_service_id);

ALTER TABLE project_allocation_sheets
  DROP INDEX IF EXISTS uq_project_allocation;

-- Existing sheets were SMM sheets: attach them to the project's SMM service
UPDATE project_allocation_sheets pas
  JOIN project_services ps ON ps.project_id = pas.project_id
  JOIN services s ON s.id = ps.service_id
   SET pas.project_service_id = ps.id
 WHERE pas.project_service_id IS NULL
   AND LOWER(s.name) IN ('smm', 'social media marketing');
