-- ------------------------------------------------------------
-- Migration: Link meetings to a project (optional)
-- Adds meetings.project_id so client meetings can be tied to a specific
-- project. Used by the Cycle "Hours Tracking" tab to attribute meeting
-- hours to the correct cycle precisely (instead of the date+client fallback).
-- Safe to run multiple times.
-- ------------------------------------------------------------

-- Add project_id column if it doesn't already exist
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'meetings'
    AND COLUMN_NAME = 'project_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE meetings ADD COLUMN project_id INT UNSIGNED DEFAULT NULL AFTER client_id',
  'SELECT "meetings.project_id already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add foreign key if it doesn't already exist
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'meetings'
    AND CONSTRAINT_NAME = 'fk_meetings_project'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE meetings ADD CONSTRAINT fk_meetings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL',
  'SELECT "fk_meetings_project already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for lookups by project
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'meetings'
    AND INDEX_NAME = 'idx_meetings_project'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_meetings_project ON meetings (project_id)',
  'SELECT "idx_meetings_project already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
