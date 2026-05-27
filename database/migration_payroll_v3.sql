USE crm_task_module;

-- ============================================================
-- Payroll v3 — Probation + Paid Leave Balance System
-- ============================================================

-- ─── Add probation_end_date to users ─────────────────────────────────────────
-- HR sets this when adding/editing an employee.
-- If NULL → employee is still in probation (or not configured).
-- If date is in the past → employee is confirmed.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS probation_end_date DATE DEFAULT NULL AFTER date_of_joining,
  ADD COLUMN IF NOT EXISTS employment_status  ENUM('probation','confirmed') NOT NULL DEFAULT 'probation' AFTER probation_end_date;

-- ─── Paid Leave Balance (monthly accrual) ────────────────────────────────────
-- One row per employee per month.
-- credited = 1 (auto-credited on 1st of month, only for confirmed employees)
-- used     = how many paid leaves consumed in that month
-- carried_forward_in = balance brought in from previous months
CREATE TABLE IF NOT EXISTS paid_leave_ledger (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT UNSIGNED NOT NULL,
  ledger_month        TINYINT NOT NULL,        -- 1–12
  ledger_year         SMALLINT NOT NULL,
  opening_balance     DECIMAL(5,2) NOT NULL DEFAULT 0,  -- balance at start of month
  credited            DECIMAL(5,2) NOT NULL DEFAULT 0,  -- leaves added this month (usually 1)
  used                DECIMAL(5,2) NOT NULL DEFAULT 0,  -- leaves consumed this month
  lop_days            DECIMAL(5,2) NOT NULL DEFAULT 0,  -- days that became LOP
  closing_balance     DECIMAL(5,2) NOT NULL DEFAULT 0,  -- opening + credited - used
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pll_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pll_emp_month (employee_id, ledger_month, ledger_year)
) ENGINE=InnoDB;

-- ─── Add paid_leave_used + paid_leave_balance columns to payroll ──────────────
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS is_probation       TINYINT(1)    NOT NULL DEFAULT 0  AFTER auto_generated,
  ADD COLUMN IF NOT EXISTS paid_leave_used    DECIMAL(5,2)  NOT NULL DEFAULT 0  AFTER is_probation,
  ADD COLUMN IF NOT EXISTS paid_leave_balance DECIMAL(5,2)  NOT NULL DEFAULT 0  AFTER paid_leave_used;
