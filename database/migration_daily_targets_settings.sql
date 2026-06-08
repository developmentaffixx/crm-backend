USE crm_task_module;

-- ─── Daily Targets Settings (single-row config) ──────────────────────────────
CREATE TABLE IF NOT EXISTS daily_targets_settings (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_mode           ENUM('single','range') NOT NULL DEFAULT 'range',
  leads_sourced_min     INT NOT NULL DEFAULT 40,
  leads_sourced_max     INT NOT NULL DEFAULT 60,
  total_outreach_min    INT NOT NULL DEFAULT 40,
  total_outreach_max    INT NOT NULL DEFAULT 60,
  follow_ups_min        INT NOT NULL DEFAULT 20,
  follow_ups_max        INT NOT NULL DEFAULT 40,
  calls_min             INT NOT NULL DEFAULT 5,
  calls_max             INT NOT NULL DEFAULT 10,
  meetings_booked_min   INT NOT NULL DEFAULT 3,
  meetings_booked_max   INT NOT NULL DEFAULT 5,
  conversion_target_min INT NOT NULL DEFAULT 2,
  conversion_target_max INT NOT NULL DEFAULT 5,
  conversion_value_min  INT NOT NULL DEFAULT 50000,
  conversion_value_max  INT NOT NULL DEFAULT 100000,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default row
INSERT IGNORE INTO daily_targets_settings (id) VALUES (1);

-- Add target_mode column if table already exists
ALTER TABLE daily_targets_settings
  ADD COLUMN IF NOT EXISTS target_mode ENUM('single','range') NOT NULL DEFAULT 'range' AFTER id;

-- Add conversion columns if table already exists
ALTER TABLE daily_targets_settings
  ADD COLUMN IF NOT EXISTS conversion_target_min INT NOT NULL DEFAULT 2 AFTER meetings_booked_max,
  ADD COLUMN IF NOT EXISTS conversion_target_max INT NOT NULL DEFAULT 5 AFTER conversion_target_min,
  ADD COLUMN IF NOT EXISTS conversion_value_min INT NOT NULL DEFAULT 50000 AFTER conversion_target_max,
  ADD COLUMN IF NOT EXISTS conversion_value_max INT NOT NULL DEFAULT 100000 AFTER conversion_value_min;
