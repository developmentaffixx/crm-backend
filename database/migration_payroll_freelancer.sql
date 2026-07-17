USE crm_task_module;

-- ============================================================
-- Payroll - Add Freelancer Support
-- Run these one by one if any fails
-- ============================================================

-- 1. Add freelancer columns
ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS is_freelancer     TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_generated,
  ADD COLUMN IF NOT EXISTS freelancer_name   VARCHAR(255) DEFAULT NULL AFTER is_freelancer,
  ADD COLUMN IF NOT EXISTS freelancer_role   VARCHAR(255) DEFAULT NULL AFTER freelancer_name;

-- 2. Drop foreign key so employee_id can be NULL
ALTER TABLE payroll DROP FOREIGN KEY fk_payroll_employee;

-- 3. Make employee_id nullable
ALTER TABLE payroll MODIFY COLUMN employee_id INT UNSIGNED DEFAULT NULL;

-- 4. Re-add foreign key (allows NULL values)
ALTER TABLE payroll ADD CONSTRAINT fk_payroll_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE;

-- 5. Drop unique key (freelancers can have multiple per month)
ALTER TABLE payroll DROP INDEX uq_payroll_month;
