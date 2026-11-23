-- Fix: Harini R (users.id = 7, emp_code AFID0006) approved sick leave on 07 Nov 2026
-- was saved as half day (first_half, 0.5) but should be a full day (1 day).
-- Also corrects the leave balance.

-- 1) Preview (check this returns exactly one row)
SELECT id, user_id, leave_type, from_date, to_date, duration, days, status
FROM leaves
WHERE user_id = 7
  AND from_date = '2026-11-07' AND to_date = '2026-11-07'
  AND duration = 'first_half' AND status = 'approved' AND deleted = 0;

START TRANSACTION;

-- 2) Adjust balance by +0.5 (run before step 3, which changes the match condition)
UPDATE leave_balances b
JOIN leaves l ON l.user_id = b.user_id AND l.leave_type = b.leave_type AND b.year = YEAR(l.from_date)
SET b.used = b.used + 0.5
WHERE l.user_id = 7
  AND l.from_date = '2026-11-07' AND l.to_date = '2026-11-07'
  AND l.duration = 'first_half' AND l.status = 'approved' AND l.deleted = 0;

-- 3) Convert the leave to a full day
UPDATE leaves
SET duration = 'full_day', days = 1, updated_at = NOW()
WHERE user_id = 7
  AND from_date = '2026-11-07' AND to_date = '2026-11-07'
  AND duration = 'first_half' AND status = 'approved' AND deleted = 0;

COMMIT;
