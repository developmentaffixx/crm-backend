USE crm_task_module;

-- ============================================================
-- Payroll History - Bulk Insert (Oct 2025 – Jul 2026)
-- ============================================================
-- Run this FIRST to get user IDs:
-- SELECT id, emp_code FROM users WHERE emp_code IN ('AFID0001', 'AFID0002');
-- Then replace the values below:

SET @akshara_id = (SELECT id FROM users WHERE emp_code = 'AFID0001');
SET @vaidya_id  = (SELECT id FROM users WHERE emp_code = 'AFID0002');
SET @admin_id   = (SELECT id FROM users WHERE is_admin = 1 LIMIT 1);

-- ─── October 2025 ─────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2510-AFID0001-001', @akshara_id, 10, 2025, 'probation', 30, 0, 0, 0, 0, 2500, 83.33, 0, 0, 0, 0, 2500, 'Bank', '2025-10-31', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id);

-- ─── November 2025 ───────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2511-FRL-001', NULL, 11, 2025, 'probation', 30, 0, 0, 0, 0, 4500, 150, 0, 0, 0, 0, 4500, 'Bank', '2025-11-05', 'Paid', 0, 1, 'Shyam Yobel', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2511-FRL-002', NULL, 11, 2025, 'probation', 30, 0, 0, 0, 0, 5000, 166.67, 0, 0, 0, 0, 5000, 'Bank', '2025-11-13', 'Paid', 0, 1, 'Kowsalya Pazhani', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2511-FRL-003', NULL, 11, 2025, 'probation', 30, 0, 0, 0, 0, 11000, 366.67, 0, 0, 0, 0, 11000, 'Bank', '2025-11-21', 'Paid', 0, 1, 'Kowsalya Pazhani', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2511-AFID0001-001', @akshara_id, 11, 2025, 'probation', 30, 0, 0, 0, 0, 5000, 166.67, 0, 0, 0, 0, 5000, 'Bank', '2025-11-30', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id);

-- ─── December 2025 ───────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2512-AFID0001-001', @akshara_id, 12, 2025, 'probation', 30, 0, 0, 0, 0, 5000, 166.67, 0, 0, 0, 0, 5000, 'Bank', '2025-12-31', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id);

-- ─── January 2026 ────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2601-AFID0001-001', @akshara_id, 1, 2026, 'probation', 30, 0, 0, 0, 0, 10000, 333.33, 0, 0, 0, 0, 10000, 'Bank', '2026-01-31', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2601-FRL-001', NULL, 1, 2026, 'probation', 30, 0, 0, 0, 0, 3000, 100, 0, 0, 0, 0, 3000, 'Bank', '2026-01-31', 'Paid', 0, 1, 'Yuthika Christy', 'Freelancer', 'Manual entry — pre CRM', @admin_id);

-- ─── February 2026 ───────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2602-AFID0001-001', @akshara_id, 2, 2026, 'probation', 30, 0, 0, 0, 0, 9667, 322.23, 0, 0, 0, 0, 9667, 'Bank', '2026-02-28', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2602-AFID0002-001', @vaidya_id, 2, 2026, 'probation', 30, 0, 0, 0, 0, 11750, 391.67, 0, 0, 0, 0, 11750, 'Bank', '2026-02-28', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id);

-- ─── March 2026 ──────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2603-AFID0001-001', @akshara_id, 3, 2026, 'permanent', 30, 0, 0, 0, 0, 9667.42, 322.25, 0, 0, 0, 0, 9667.42, 'Bank', '2026-03-31', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2603-AFID0002-001', @vaidya_id, 3, 2026, 'permanent', 30, 0, 0, 0, 0, 15000, 500, 0, 0, 0, 0, 15000, 'Bank', '2026-03-31', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id);

-- ─── April 2026 ──────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2604-AFID0001-001', @akshara_id, 4, 2026, 'permanent', 30, 0, 0, 0, 0, 10000, 333.33, 0, 0, 0, 0, 10000, 'Bank', '2026-05-07', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2604-AFID0002-001', @vaidya_id, 4, 2026, 'permanent', 30, 0, 0, 0, 0, 13750, 458.33, 0, 0, 0, 0, 13750, 'Bank', '2026-05-07', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2604-FRL-001', NULL, 4, 2026, 'probation', 30, 0, 0, 0, 0, 15000, 500, 0, 0, 0, 0, 15000, 'Bank', '2026-05-07', 'Paid', 0, 1, 'Prahashini', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2604-FRL-002', NULL, 4, 2026, 'probation', 30, 0, 0, 0, 0, 4000, 133.33, 0, 0, 0, 0, 4000, 'Bank', '2026-05-07', 'Paid', 0, 1, 'Devaguru', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2604-FRL-003', NULL, 4, 2026, 'probation', 30, 0, 0, 0, 0, 3500, 116.67, 0, 0, 0, 0, 3500, 'Bank', '2026-05-07', 'Paid', 0, 1, 'Sachin Sajal Kumar', 'Freelancer', 'Manual entry — pre CRM', @admin_id);

-- ─── May 2026 ────────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2605-FRL-001', NULL, 5, 2026, 'probation', 30, 0, 0, 0, 0, 10000, 333.33, 0, 0, 0, 0, 10000, 'Bank', '2026-05-28', 'Paid', 0, 1, 'Abarna', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2605-AFID0001-001', @akshara_id, 5, 2026, 'permanent', 30, 0, 0, 0, 0, 10000, 333.33, 0, 0, 0, 0, 10000, 'Bank', '2026-05-30', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2605-AFID0002-001', @vaidya_id, 5, 2026, 'permanent', 30, 0, 0, 0, 0, 15000, 500, 0, 0, 0, 0, 15000, 'Bank', '2026-05-30', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2605-FRL-002', NULL, 5, 2026, 'probation', 30, 0, 0, 0, 0, 3500, 116.67, 0, 0, 0, 0, 3500, 'Bank', '2026-05-30', 'Paid', 0, 1, 'Deva Guru', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2605-FRL-003', NULL, 5, 2026, 'probation', 30, 0, 0, 0, 0, 2500, 83.33, 0, 0, 0, 0, 2500, 'Bank', '2026-06-03', 'Paid', 0, 1, 'Pooja M', 'Freelancer', 'Manual entry — pre CRM', @admin_id);

-- ─── June 2026 ───────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2606-AFID0001-001', @akshara_id, 6, 2026, 'permanent', 30, 0, 0, 0, 0, 15000, 500, 0, 0, 0, 0, 15000, 'Bank', '2026-06-30', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2606-AFID0002-001', @vaidya_id, 6, 2026, 'permanent', 30, 0, 0, 0, 0, 18000, 600, 0, 0, 0, 0, 18000, 'Bank', '2026-06-30', 'Paid', 0, 0, NULL, NULL, 'Manual entry — pre CRM', @admin_id),
('PAY-2606-FRL-001', NULL, 6, 2026, 'probation', 30, 0, 0, 0, 0, 2500, 83.33, 0, 0, 0, 0, 2500, 'Bank', '2026-06-30', 'Paid', 0, 1, 'Pooja', 'Freelancer', 'Manual entry — pre CRM', @admin_id);

-- ─── July 2026 ───────────────────────────────────────────────────────────────
INSERT INTO payroll (payroll_code, employee_id, pay_month, pay_year, employment_status, working_days, days_present, absent_days, paid_leave_used, lop_days, monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary, payment_mode, payment_date, status, auto_generated, is_freelancer, freelancer_name, freelancer_role, notes, created_by)
VALUES
('PAY-2607-FRL-001', NULL, 7, 2026, 'probation', 30, 0, 0, 0, 0, 5000, 166.67, 0, 0, 0, 0, 5000, 'Bank', '2026-07-11', 'Paid', 0, 1, 'Devaguru', 'Freelancer', 'Manual entry — pre CRM', @admin_id),
('PAY-2607-FRL-002', NULL, 7, 2026, 'probation', 30, 0, 0, 0, 0, 4000, 133.33, 0, 0, 0, 0, 4000, 'Bank', '2026-07-11', 'Paid', 0, 1, 'Devaguru', 'Freelancer', 'Manual entry — pre CRM', @admin_id);
