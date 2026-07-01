USE crm_task_module;

-- ============================================================
-- Payroll Module (New — Simple & Clean)
-- ============================================================

-- ─── 1. Add employment_status + probation_end_date to users (if not exists) ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employment_status ENUM('probation','permanent') NOT NULL DEFAULT 'probation' AFTER date_of_joining,
  ADD COLUMN IF NOT EXISTS last_working_date DATE DEFAULT NULL AFTER employment_status;

-- ─── 2. Employee Salary table ─────────────────────────────────────────────────
-- One active salary per employee. HR updates when salary changes.
CREATE TABLE IF NOT EXISTS employee_salary (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id     INT UNSIGNED NOT NULL,
  monthly_salary  DECIMAL(12,2) NOT NULL DEFAULT 0,
  effective_from  DATE NOT NULL,
  created_by      INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_es_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_es_created  FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB;

-- ─── 3. Payroll table ─────────────────────────────────────────────────────────
-- One record per employee per month
CREATE TABLE IF NOT EXISTS payroll (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payroll_code      VARCHAR(50) DEFAULT NULL,          -- PAY-2607-EMPCODE-001
  employee_id       INT UNSIGNED NOT NULL,
  pay_month         TINYINT UNSIGNED NOT NULL,          -- 1–12
  pay_year          SMALLINT UNSIGNED NOT NULL,
  employment_status ENUM('probation','permanent') NOT NULL DEFAULT 'probation',

  -- Attendance
  working_days      TINYINT UNSIGNED NOT NULL DEFAULT 30,
  days_present      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  absent_days       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  paid_leave_used   DECIMAL(4,1)     NOT NULL DEFAULT 0,  -- 0 or 1
  lop_days          DECIMAL(4,1)     NOT NULL DEFAULT 0,

  -- Salary
  monthly_salary    DECIMAL(12,2)    NOT NULL DEFAULT 0,
  per_day_salary    DECIMAL(12,2)    NOT NULL DEFAULT 0,
  lop_deduction     DECIMAL(12,2)    NOT NULL DEFAULT 0,
  bonus             DECIMAL(12,2)    NOT NULL DEFAULT 0,
  advance_deduction DECIMAL(12,2)    NOT NULL DEFAULT 0,
  other_deduction   DECIMAL(12,2)    NOT NULL DEFAULT 0,
  net_salary        DECIMAL(12,2)    NOT NULL DEFAULT 0,

  -- Payment
  payment_mode      ENUM('Bank','Cash','UPI','Cheque') NOT NULL DEFAULT 'Bank',
  payment_date      DATE DEFAULT NULL,
  status            ENUM('Draft','Paid') NOT NULL DEFAULT 'Draft',
  notes             TEXT DEFAULT NULL,

  -- Meta
  auto_generated    TINYINT(1)       NOT NULL DEFAULT 0,
  created_by        INT UNSIGNED     NOT NULL,
  deleted           TINYINT(1)       NOT NULL DEFAULT 0,
  created_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_payroll_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_payroll_created  FOREIGN KEY (created_by)  REFERENCES users(id),
  UNIQUE KEY uq_payroll_month (employee_id, pay_month, pay_year, deleted)
) ENGINE=InnoDB;
