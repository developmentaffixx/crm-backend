USE crm_task_module;

-- ─── Add new columns to users table ──────────────────────────────────────────
-- Run this after schema.sql and migration_settings.sql

-- Profile fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone          VARCHAR(50)  NOT NULL DEFAULT '' AFTER email;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url     VARCHAR(500) NOT NULL DEFAULT '' AFTER phone;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department     VARCHAR(100) NOT NULL DEFAULT '' AFTER avatar_url;
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation    VARCHAR(100) NOT NULL DEFAULT '' AFTER department;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining DATE DEFAULT NULL AFTER designation;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reporting_to   INT UNSIGNED DEFAULT NULL AFTER date_of_joining;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  DATETIME DEFAULT NULL AFTER reporting_to;

-- Invite token (for invite-via-email flow)
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token   VARCHAR(100) DEFAULT NULL AFTER last_login_at;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_sent_at DATETIME DEFAULT NULL AFTER invite_token;

-- Foreign key for reporting_to
ALTER TABLE users ADD CONSTRAINT fk_users_reporting FOREIGN KEY (reporting_to) REFERENCES users(id) ON DELETE SET NULL;
