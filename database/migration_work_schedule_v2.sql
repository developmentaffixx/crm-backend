USE crm_task_module;

-- ============================================================
-- Work Schedule V2 - Add Saturday Pattern + Weekly Overrides
-- ============================================================

-- Add saturday_pattern column to work_schedule (replace saturday_type)
ALTER TABLE work_schedule 
  ADD COLUMN saturday_pattern ENUM('all_full','all_half','all_off','alternate_half_off','alternate_full_off') NOT NULL DEFAULT 'alternate_half_off' AFTER friday_type;

-- Drop the old saturday_type column if it exists
ALTER TABLE work_schedule DROP COLUMN IF EXISTS saturday_type;

-- Create weekly_schedule_overrides table
CREATE TABLE IF NOT EXISTS weekly_schedule_overrides (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  week_start            DATE NOT NULL COMMENT 'Monday of the week being overridden',
  monday_type           ENUM('full','half','off') NOT NULL DEFAULT 'full',
  tuesday_type          ENUM('full','half','off') NOT NULL DEFAULT 'full',
  wednesday_type        ENUM('full','half','off') NOT NULL DEFAULT 'full',
  thursday_type         ENUM('full','half','off') NOT NULL DEFAULT 'full',
  friday_type           ENUM('full','half','off') NOT NULL DEFAULT 'full',
  saturday_type         ENUM('full','half','off') NOT NULL DEFAULT 'half',
  sunday_type           ENUM('full','half','off') NOT NULL DEFAULT 'off',
  reason                VARCHAR(255) DEFAULT NULL COMMENT 'Why this week was overridden',
  created_by            INT UNSIGNED DEFAULT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_week_start (week_start),
  CONSTRAINT fk_override_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE INDEX idx_override_week ON weekly_schedule_overrides (week_start);
