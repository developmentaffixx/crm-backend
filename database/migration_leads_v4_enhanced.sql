USE crm_task_module;

-- ============================================================
-- Leads Module v4 - Enhanced Fields (Lead Stage, Score, etc.)
-- ============================================================

-- Add lead_stage column (replaces basic status for pipeline tracking)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_stage VARCHAR(50) DEFAULT 'Cold' AFTER status;

-- Add lead_score (1-5 scoring)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_score TINYINT UNSIGNED DEFAULT 1 AFTER lead_stage;

-- Add expected_revenue
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS expected_revenue DECIMAL(12,2) DEFAULT NULL AFTER lead_score;

-- Add next_action
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS next_action VARCHAR(100) DEFAULT NULL AFTER expected_revenue;

-- Add interested_services (comma-separated or JSON)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS interested_services VARCHAR(500) DEFAULT NULL AFTER next_action;

-- Add outcome column to lead_follow_ups if not exists
ALTER TABLE lead_follow_ups
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(100) DEFAULT NULL AFTER type;

-- ============================================================
-- Update daily_targets_settings - Rename to monthly targets
-- ============================================================

-- Rename conversion columns to monthly
ALTER TABLE daily_targets_settings
  CHANGE COLUMN conversion_target_min monthly_conversion_min INT NOT NULL DEFAULT 3,
  CHANGE COLUMN conversion_target_max monthly_conversion_max INT NOT NULL DEFAULT 5,
  CHANGE COLUMN conversion_value_min monthly_revenue_min INT NOT NULL DEFAULT 150000,
  CHANGE COLUMN conversion_value_max monthly_revenue_max INT NOT NULL DEFAULT 200000;

-- Update default target values per document recommendations
UPDATE daily_targets_settings SET
  leads_sourced_min = 40,
  leads_sourced_max = 50,
  total_outreach_min = 30,
  total_outreach_max = 40,
  follow_ups_min = 10,
  follow_ups_max = 15,
  calls_min = 2,
  calls_max = 3,
  meetings_booked_min = 1,
  meetings_booked_max = 2,
  monthly_conversion_min = 3,
  monthly_conversion_max = 5,
  monthly_revenue_min = 150000,
  monthly_revenue_max = 200000
WHERE id = 1;
