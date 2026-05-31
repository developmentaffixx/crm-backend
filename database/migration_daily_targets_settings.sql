USE crm_task_module;

-- ─── Daily Targets Settings (single-row config) ──────────────────────────────
CREATE TABLE IF NOT EXISTS daily_targets_settings (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default row
INSERT IGNORE INTO daily_targets_settings (id) VALUES (1);
