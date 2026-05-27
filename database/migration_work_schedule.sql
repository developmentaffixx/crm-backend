USE crm_task_module;

-- ============================================================
-- Work Schedule & Company Holidays - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Work Schedule (single-row default template)
-- Defines the default weekly pattern + Saturday pattern
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_schedule (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  monday_type           ENUM('full','half','off') NOT NULL DEFAULT 'full',
  tuesday_type          ENUM('full','half','off') NOT NULL DEFAULT 'full',
  wednesday_type        ENUM('full','half','off') NOT NULL DEFAULT 'full',
  thursday_type         ENUM('full','half','off') NOT NULL DEFAULT 'full',
  friday_type           ENUM('full','half','off') NOT NULL DEFAULT 'full',
  saturday_pattern      ENUM('all_full','all_half','all_off','alternate_half_off','alternate_full_off') NOT NULL DEFAULT 'alternate_half_off',
  sunday_type           ENUM('full','half','off') NOT NULL DEFAULT 'off',
  full_day_hours        DECIMAL(3,1) NOT NULL DEFAULT 8.0 COMMENT 'Productive hours for a full day',
  half_day_hours        DECIMAL(3,1) NOT NULL DEFAULT 4.0 COMMENT 'Productive hours for a half day',
  full_day_total        DECIMAL(3,1) NOT NULL DEFAULT 9.0 COMMENT 'Total hours including lunch for full day',
  half_day_total        DECIMAL(4,1) NOT NULL DEFAULT 4.5 COMMENT 'Total hours including break for half day',
  lunch_minutes_full    INT UNSIGNED NOT NULL DEFAULT 60 COMMENT 'Lunch break minutes for full day',
  lunch_minutes_half    INT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'Break minutes for half day',
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed default schedule
INSERT IGNORE INTO work_schedule (id) VALUES (1);

-- ------------------------------------------------------------
-- Weekly Schedule Overrides
-- Admin can override specific weeks when the default pattern
-- doesn't apply (e.g., special Saturday change)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Company Holidays
-- Handles government holidays, festivals, emergencies, etc.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_holidays (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  date              DATE NOT NULL,
  title             VARCHAR(255) NOT NULL,
  holiday_type      ENUM('full_holiday','half_day','restricted') NOT NULL DEFAULT 'full_holiday',
  half_day_session  ENUM('morning','afternoon') DEFAULT NULL COMMENT 'Which session is working if half_day',
  category          ENUM('government','festival','company','emergency') NOT NULL DEFAULT 'company',
  is_recurring      TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 if repeats same date every year',
  description       TEXT DEFAULT NULL,
  declared_by       INT UNSIGNED DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_holiday_date (date),
  CONSTRAINT fk_holiday_declared_by FOREIGN KEY (declared_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Indexes for quick lookups
CREATE INDEX idx_holiday_date ON company_holidays (date);
CREATE INDEX idx_holiday_category ON company_holidays (category);
CREATE INDEX idx_override_week ON weekly_schedule_overrides (week_start);
