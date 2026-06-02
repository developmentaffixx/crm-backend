USE crm_task_module;

-- ============================================================
-- Payroll v5 — Fixed 30 Days + Paid Leave Lapse Policy
-- ============================================================
-- Policy Changes:
--   1. Working days per month changed from 26 to 30 (fixed, every month)
--   2. Per Day Salary = Monthly Salary / 30
--   3. Paid Leave: 1 per month, LAPSE (does NOT carry forward)
--      - If absent ≤ 1 day → covered by paid leave, no deduction
--      - If absent > 1 day → LOP = absent days - 1
-- ============================================================

-- ─── Update default working_days_per_month from 26 to 30 ─────────────────────
ALTER TABLE salary_structures
  MODIFY COLUMN working_days_per_month TINYINT UNSIGNED NOT NULL DEFAULT 30;

-- ─── Update existing structures that still have 26 to 30 ─────────────────────
UPDATE salary_structures SET working_days_per_month = 30 WHERE working_days_per_month = 26;

-- ─── Reset paid_leave_ledger closing balances (lapse policy — no accumulation)
-- Any previously accumulated balances should be reset since leaves no longer carry forward.
-- This ensures clean slate for the lapse policy going forward.
UPDATE paid_leave_ledger SET closing_balance = GREATEST(0, credited - used) WHERE closing_balance > 1;
