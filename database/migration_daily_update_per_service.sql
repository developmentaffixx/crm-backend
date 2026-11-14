-- ============================================================
-- Daily Update: one entry per Project ▸ Service ▸ Date ▸ User
-- MariaDB syntax (IF [NOT] EXISTS). Safe to run more than once.
-- The backend also runs these steps automatically on startup.
-- Existing entries keep project_service_id = NULL (not backfilled).
-- ============================================================

ALTER TABLE smm_daily_journal
  ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL AFTER project_id;

ALTER TABLE smm_daily_journal
  ADD INDEX IF NOT EXISTS idx_sdj_service (project_service_id);

ALTER TABLE smm_daily_journal
  ADD INDEX IF NOT EXISTS idx_sdj_date_user (journal_date, submitted_by);

-- Add the new unique key first so the project_id foreign key keeps an index
ALTER TABLE smm_daily_journal
  ADD UNIQUE INDEX IF NOT EXISTS uq_journal_entry_svc (project_id, project_service_id, journal_date, submitted_by);

-- Old key (project, date, user) blocks a second service on the same project
ALTER TABLE smm_daily_journal
  DROP INDEX IF EXISTS uq_journal_entry;
