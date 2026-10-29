USE crm_task_module;

-- ============================================================
-- SM Ops Content Calendar — Two-Stage Approval Workflow
-- ============================================================
-- Splits the single "Approve / Reject" permission into two
-- independent toggles:
--   can_smm_approve   -> SMM Approval  (accept / rework submitted content)
--   can_pcpm_approve  -> PC/PM Approval (final approve / reject)
-- "Mark as Done" (can_complete) stays independent and is usable
-- by anyone holding EITHER approval toggle (or admin).
--
-- Also adds an intermediate slot_status 'smm_approved' (shown in
-- the UI as "SMM Reviewed") between 'submitted' and 'approved',
-- plus tracking columns for who did the SMM review and when.
--
-- This script is SAFE TO RE-RUN: every ADD COLUMN is guarded by an
-- information_schema check so it will not error if already applied.
-- ============================================================

-- ------------------------------------------------------------
-- Helper pattern: add a column only if it does not already exist.
-- ------------------------------------------------------------

-- 1. role_permissions.can_smm_approve
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permissions' AND COLUMN_NAME = 'can_smm_approve');
SET @sql := IF(@c = 0,
  'ALTER TABLE role_permissions ADD COLUMN can_smm_approve TINYINT(1) NOT NULL DEFAULT 0 AFTER can_approve',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- role_permissions.can_pcpm_approve
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permissions' AND COLUMN_NAME = 'can_pcpm_approve');
SET @sql := IF(@c = 0,
  'ALTER TABLE role_permissions ADD COLUMN can_pcpm_approve TINYINT(1) NOT NULL DEFAULT 0 AFTER can_smm_approve',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. user_permissions.can_smm_approve
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_permissions' AND COLUMN_NAME = 'can_smm_approve');
SET @sql := IF(@c = 0,
  'ALTER TABLE user_permissions ADD COLUMN can_smm_approve TINYINT(1) NOT NULL DEFAULT 0 AFTER can_approve',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- user_permissions.can_pcpm_approve
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_permissions' AND COLUMN_NAME = 'can_pcpm_approve');
SET @sql := IF(@c = 0,
  'ALTER TABLE user_permissions ADD COLUMN can_pcpm_approve TINYINT(1) NOT NULL DEFAULT 0 AFTER can_smm_approve',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------------------
-- 3. Backfill: anyone who currently has can_approve on the SM Ops
--    (creative_hub) module gets BOTH new toggles granted, so no
--    existing approver loses access. Fine-tune per role afterwards.
-- ------------------------------------------------------------
UPDATE role_permissions
  SET can_smm_approve = 1, can_pcpm_approve = 1
  WHERE module = 'creative_hub' AND can_approve = 1;

UPDATE user_permissions
  SET can_smm_approve = 1, can_pcpm_approve = 1
  WHERE module = 'creative_hub' AND can_approve = 1;

-- ------------------------------------------------------------
-- 4. Add intermediate 'smm_approved' status to the slot enums.
--    MODIFY is naturally re-runnable (idempotent).
-- ------------------------------------------------------------
ALTER TABLE content_calendar_posts
  MODIFY COLUMN slot_status ENUM('open','assigned','submitted','smm_approved','approved','rejected','completed') NOT NULL DEFAULT 'open';

ALTER TABLE content_calendar_shoots
  MODIFY COLUMN slot_status ENUM('open','assigned','submitted','smm_approved','approved','rejected','completed') NOT NULL DEFAULT 'open';

ALTER TABLE content_calendar_ads
  MODIFY COLUMN slot_status ENUM('open','assigned','submitted','smm_approved','approved','rejected','completed') NOT NULL DEFAULT 'open';

-- ------------------------------------------------------------
-- 5. SMM review tracking columns on each slot table (guarded).
-- ------------------------------------------------------------

-- posts.smm_approved_by
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_calendar_posts' AND COLUMN_NAME = 'smm_approved_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE content_calendar_posts ADD COLUMN smm_approved_by INT UNSIGNED DEFAULT NULL AFTER approved_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- posts.smm_approved_at
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_calendar_posts' AND COLUMN_NAME = 'smm_approved_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE content_calendar_posts ADD COLUMN smm_approved_at DATETIME DEFAULT NULL AFTER smm_approved_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- shoots.smm_approved_by
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_calendar_shoots' AND COLUMN_NAME = 'smm_approved_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE content_calendar_shoots ADD COLUMN smm_approved_by INT UNSIGNED DEFAULT NULL AFTER approved_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- shoots.smm_approved_at
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_calendar_shoots' AND COLUMN_NAME = 'smm_approved_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE content_calendar_shoots ADD COLUMN smm_approved_at DATETIME DEFAULT NULL AFTER smm_approved_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ads.smm_approved_by
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_calendar_ads' AND COLUMN_NAME = 'smm_approved_by');
SET @sql := IF(@c = 0,
  'ALTER TABLE content_calendar_ads ADD COLUMN smm_approved_by INT UNSIGNED DEFAULT NULL AFTER approved_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ads.smm_approved_at
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_calendar_ads' AND COLUMN_NAME = 'smm_approved_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE content_calendar_ads ADD COLUMN smm_approved_at DATETIME DEFAULT NULL AFTER smm_approved_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Done.
SELECT 'migration_smm_two_stage_approval applied' AS status;
