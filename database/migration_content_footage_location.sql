USE crm_task_module;

-- ============================================================
-- Migration: Add Footage / Drive Location and Shoot Statement
-- ============================================================

ALTER TABLE content_calendar_posts
  ADD COLUMN footage_drive_link TEXT DEFAULT NULL,
  ADD COLUMN shoot_statement TEXT DEFAULT NULL,
  ADD COLUMN footage_updated_by INT UNSIGNED DEFAULT NULL,
  ADD COLUMN footage_updated_at DATETIME DEFAULT NULL;

-- Optional foreign key constraint (wrapped safely)
-- ALTER TABLE content_calendar_posts ADD CONSTRAINT fk_ccp_footage_user FOREIGN KEY (footage_updated_by) REFERENCES users(id) ON DELETE SET NULL;
