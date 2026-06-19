-- ============================================================
-- Fix clock_in_status for all past attendance records
-- Recalculates based on actual clock_in time in IST (UTC+5:30)
--
-- Rules:
--   <= 09:00 AM IST  → on_time
--   09:01 - 09:10 AM IST → grace
--   > 09:10 AM IST   → late
-- ============================================================

USE crm_task_module;

-- Preview before updating (run this SELECT first to verify)
SELECT
  id,
  user_id,
  date,
  clock_in,
  TIME(CONVERT_TZ(clock_in, '+00:00', '+05:30')) AS clock_in_ist,
  clock_in_status AS old_status,
  CASE
    WHEN TIME(CONVERT_TZ(clock_in, '+00:00', '+05:30')) <= '09:00:00' THEN 'on_time'
    WHEN TIME(CONVERT_TZ(clock_in, '+00:00', '+05:30')) <= '09:10:00' THEN 'grace'
    ELSE 'late'
  END AS new_status
FROM attendance
ORDER BY date DESC;

-- ============================================================
-- Run the UPDATE after verifying the SELECT above looks correct
-- ============================================================

UPDATE attendance
SET clock_in_status = CASE
  WHEN TIME(CONVERT_TZ(clock_in, '+00:00', '+05:30')) <= '09:00:00' THEN 'on_time'
  WHEN TIME(CONVERT_TZ(clock_in, '+00:00', '+05:30')) <= '09:10:00' THEN 'grace'
  ELSE 'late'
END;

-- Confirm results
SELECT
  clock_in_status,
  COUNT(*) AS total
FROM attendance
GROUP BY clock_in_status;
