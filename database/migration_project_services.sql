-- ============================================================
-- Project Services Module - Database Migration
-- SAFE: Only creates new tables and adds new columns
-- Does NOT drop or modify existing columns/data
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Project Services table (many-to-many: one project can have multiple services)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_services (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id      INT UNSIGNED NOT NULL,
  service_id      INT UNSIGNED NOT NULL,
  start_date      DATE DEFAULT NULL,
  end_date        DATE DEFAULT NULL,
  status          ENUM('active','paused','completed','cancelled') NOT NULL DEFAULT 'active',
  notes           TEXT,
  created_by      INT UNSIGNED DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ps_project  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ps_service  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_ps_created  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_project_service (project_id, service_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Add project_service_id to service_cycles (nullable for backward compat)
-- Existing cycles that already have project_id will still work
-- ------------------------------------------------------------
ALTER TABLE service_cycles
  ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL AFTER project_id,
  ADD CONSTRAINT fk_sc_project_service FOREIGN KEY (project_service_id) REFERENCES project_services(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- DATA MIGRATION: Populate project_services from existing projects
-- For each project that has a service_id, create a row in project_services
-- ------------------------------------------------------------
INSERT IGNORE INTO project_services (project_id, service_id, start_date, end_date, status, created_by)
SELECT 
  p.id,
  p.service_id,
  p.start_date,
  p.end_date,
  p.status,
  p.created_by
FROM projects p
WHERE p.service_id IS NOT NULL
  AND p.deleted = 0;

-- ------------------------------------------------------------
-- DATA MIGRATION: Backfill project_service_id on existing cycles
-- Link each cycle to its project's service in project_services
-- ------------------------------------------------------------
UPDATE service_cycles sc
JOIN project_services ps ON ps.project_id = sc.project_id
SET sc.project_service_id = ps.id
WHERE sc.project_service_id IS NULL;
