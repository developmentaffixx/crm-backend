-- Migration: Replace lead_qualifications with lead_qualification_scores
-- This drops the old qualification checklist table and creates a new scoring table

-- Drop old table
DROP TABLE IF EXISTS lead_qualifications;

-- Create new Lead Qualification Score table
CREATE TABLE IF NOT EXISTS lead_qualification_scores (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id INT UNSIGNED NOT NULL,

  -- Scoring Categories (each 1-5)
  industry_fit TINYINT UNSIGNED DEFAULT 0,
  business_potential TINYINT UNSIGNED DEFAULT 0,
  marketing_need TINYINT UNSIGNED DEFAULT 0,
  growth_potential TINYINT UNSIGNED DEFAULT 0,
  budget_potential TINYINT UNSIGNED DEFAULT 0,
  decision_maker_access TINYINT UNSIGNED DEFAULT 0,
  timing_urgency TINYINT UNSIGNED DEFAULT 0,
  digital_gap TINYINT UNSIGNED DEFAULT 0,

  -- Computed fields
  total_score TINYINT UNSIGNED DEFAULT 0,  -- Sum of all scores (max 40)
  priority ENUM('HOT', 'WARM', 'NURTURE', 'LOW PRIORITY') DEFAULT NULL,

  -- Meta
  scored_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_lead (lead_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (scored_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Priority Logic:
-- 32-40 → HOT (Immediately prioritize for calling and meeting booking)
-- 24-31 → WARM (Call and follow up consistently)
-- 16-23 → NURTURE (Keep in the database and revisit)
-- Below 16 → LOW PRIORITY (Do not spend excessive sales time)
