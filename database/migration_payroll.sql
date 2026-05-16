USE crm_task_module;

-- ============================================================
-- Payroll Module - Database Migration
-- ============================================================

-- ─── Salary Structures (template per employee) ────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_structures (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id       INT UNSIGNED NOT NULL,
  basic_salary      DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra               DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowances        DECIMAL(12,2) NOT NULL DEFAULT 0,
  pf_deduction      DECIMAL(12,2) NOT NULL DEFAULT 0,
  esi_deduction     DECIMAL(12,2) NOT NULL DEFAULT 0,
  professional_tax  DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_deductions  DECIMAL(12,2) NOT NULL DEFAULT 0,
  effective_from    DATE NOT NULL,
  created_by        INT UNSIGNED NOT NULL,
  deleted           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_salary_employee  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_salary_created   FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ─── Payroll Records (monthly payslips) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id       INT UNSIGNED NOT NULL,
  pay_month         TINYINT NOT NULL,
  pay_year          SMALLINT NOT NULL,
  basic_salary      DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra               DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowances        DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross_salary      DECIMAL(12,2) NOT NULL DEFAULT 0,
  pf_deduction      DECIMAL(12,2) NOT NULL DEFAULT 0,
  esi_deduction     DECIMAL(12,2) NOT NULL DEFAULT 0,
  professional_tax  DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_deductions  DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_deductions  DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_salary        DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_mode      ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Bank',
  payment_date      DATE DEFAULT NULL,
  status            ENUM('Draft','Paid') NOT NULL DEFAULT 'Draft',
  notes             TEXT DEFAULT NULL,
  created_by        INT UNSIGNED NOT NULL,
  deleted           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payroll_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_payroll_created  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uk_payroll_month (employee_id, pay_month, pay_year, deleted)
) ENGINE=InnoDB;
