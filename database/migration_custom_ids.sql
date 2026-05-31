USE crm_task_module;

-- ============================================================
-- Custom ID Codes Migration
-- Adds formatted ID columns to all major modules
-- ============================================================

-- Projects: PRJ-CLIENT-### (e.g., PRJ-AFXCL001-001)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_id_code VARCHAR(30) DEFAULT NULL AFTER id;
ALTER TABLE projects ADD UNIQUE INDEX uk_project_id_code (project_id_code);

-- Tasks: TSK-YYMMDD-### (e.g., TSK-250425-001)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_id_code VARCHAR(20) DEFAULT NULL AFTER id;
ALTER TABLE tasks ADD UNIQUE INDEX uk_task_id_code (task_id_code);

-- Tickets: TKT-YYMM-CLIENT-### (e.g., TKT-2504-AFXCL001-001)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_id_code VARCHAR(30) DEFAULT NULL AFTER id;
ALTER TABLE tickets ADD UNIQUE INDEX uk_ticket_id_code (ticket_id_code);

-- Content Write: CNT-CLIENT-### (e.g., CNT-AFXCL001-001)
ALTER TABLE content_write_requests ADD COLUMN IF NOT EXISTS content_id_code VARCHAR(30) DEFAULT NULL AFTER id;
ALTER TABLE content_write_requests ADD UNIQUE INDEX uk_content_id_code (content_id_code);

-- Shoots: SHT-YYMMDD-CLIENT-### (e.g., SHT-250425-AFXCL001-001)
ALTER TABLE shoots ADD COLUMN IF NOT EXISTS shoot_id_code VARCHAR(30) DEFAULT NULL AFTER id;
ALTER TABLE shoots ADD UNIQUE INDEX uk_shoot_id_code (shoot_id_code);

-- Expenses: EXP-YYMM-### (e.g., EXP-2504-001)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_id_code VARCHAR(20) DEFAULT NULL AFTER id;
ALTER TABLE expenses ADD UNIQUE INDEX uk_expense_id_code (expense_id_code);

-- Users/Employees: DOUBT for admin, AFID### for team members (e.g., AFID001)
ALTER TABLE users ADD COLUMN IF NOT EXISTS emp_code VARCHAR(10) DEFAULT NULL AFTER id;
ALTER TABLE users ADD UNIQUE INDEX uk_emp_code (emp_code);

-- Payroll: PAY-YYMM-EMP-### (e.g., PAY-2504-EMP001-001)
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payroll_id_code VARCHAR(30) DEFAULT NULL AFTER id;
ALTER TABLE payroll ADD UNIQUE INDEX uk_payroll_id_code (payroll_id_code);
