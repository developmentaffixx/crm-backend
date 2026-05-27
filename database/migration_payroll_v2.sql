USE crm_task_module;

-- ============================================================
-- Payroll v2 Migration
-- Adds: LOP fields, auto_generated flag, payroll_id_code,
--       cron_log table, working_days_in_month
-- ============================================================

-- ─── Add new columns to payroll table ────────────────────────────────────────
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS working_days      TINYINT UNSIGNED NOT NULL DEFAULT 0  AFTER allowances,
  ADD COLUMN IF NOT EXISTS days_present      TINYINT UNSIGNED NOT NULL DEFAULT 0  AFTER working_days,
  ADD COLUMN IF NOT EXISTS lop_days          DECIMAL(5,2)     NOT NULL DEFAULT 0  AFTER days_present,
  ADD COLUMN IF NOT EXISTS lop_deduction     DECIMAL(12,2)    NOT NULL DEFAULT 0  AFTER lop_days,
  ADD COLUMN IF NOT EXISTS auto_generated    TINYINT(1)       NOT NULL DEFAULT 0  AFTER lop_deduction,
  ADD COLUMN IF NOT EXISTS payroll_id_code   VARCHAR(50)      DEFAULT NULL        AFTER id;

-- ─── Cron job execution log ───────────────────────────────────────────────────
-- Tracks every time the auto-generate cron runs
CREATE TABLE IF NOT EXISTS payroll_cron_log (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pay_month     TINYINT NOT NULL,
  pay_year      SMALLINT NOT NULL,
  created_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT NULL,
  status        ENUM('success','partial','failed') NOT NULL DEFAULT 'success'
) ENGINE=InnoDB;
