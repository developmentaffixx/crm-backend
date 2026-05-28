USE crm_task_module;

-- ============================================================
-- Payroll v4 — Probation dates, Hike, Per Day/Hour in structure
-- ============================================================

-- ─── Add new fields to salary_structures ──────────────────────────────────────
ALTER TABLE salary_structures
  ADD COLUMN IF NOT EXISTS probation_start_date    DATE DEFAULT NULL AFTER effective_from,
  ADD COLUMN IF NOT EXISTS probation_end_date      DATE DEFAULT NULL AFTER probation_start_date,
  ADD COLUMN IF NOT EXISTS employment_status       ENUM('probation','confirmed') NOT NULL DEFAULT 'probation' AFTER probation_end_date,
  ADD COLUMN IF NOT EXISTS hike_amount             DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER employment_status,
  ADD COLUMN IF NOT EXISTS post_probation_salary   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER hike_amount,
  ADD COLUMN IF NOT EXISTS per_day_salary          DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER post_probation_salary,
  ADD COLUMN IF NOT EXISTS per_hour_salary         DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER per_day_salary,
  ADD COLUMN IF NOT EXISTS working_days_per_month  TINYINT UNSIGNED NOT NULL DEFAULT 26 AFTER per_hour_salary,
  ADD COLUMN IF NOT EXISTS working_hours_per_day   TINYINT UNSIGNED NOT NULL DEFAULT 8 AFTER working_days_per_month;

-- ─── Add per_day and per_hour to payroll records for display ──────────────────
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS per_day_salary   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER paid_leave_balance,
  ADD COLUMN IF NOT EXISTS per_hour_salary  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER per_day_salary;
