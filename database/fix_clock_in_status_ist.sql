-- ============================================================
-- Fix clock_in_status for all past attendance records
-- Recalculates based on actual clock_in time in IST (UTC+5:30)
--
-- Rules (minute-based, seconds ignored):
--   <= 09:00:59 IST (minute 0 or less)  → on_time
--   09:01:00 - 09:10:59 IST (minutes 1-10) → grace
--   >= 09:11:00 IST (minute 11+)        → late
-- ============================================================

USE crm_task_module;

-- Preview before updating (run this SELECT first to verify)
SELECT
  id,
  user_id,
  date,
  clock_in,
  TIME(CONVERT_TZ(clock_in, '+00:00', '+05:30')) AS clock_in_ist,
  HOUR(CONVERT_TZ(clock_in, '+00:00', '+05:30')) AS ist_hour,
  MINUTE(CONVERT_TZ(clock_in, '+00:00', '+05:30')) AS ist_minute,
  clock_in_status AS old_status,
  CASE
    WHEN (HOUR(CONVERT_TZ(clock_in, '+00:00', '+05:30')) * 60 + MINUTE(CONVERT_TZ(clock_in, '+00:00', '+05:30'))) <= (9 * 60 + 0) THEN 'on_time'
    WHEN (HOUR(CONVERT_TZ(clock_in, '+00:00', '+05:30')) * 60 + MINUTE(CONVERT_TZ(clock_in, '+00:00', '+05:30'))) <= (9 * 60 + 10) THEN 'grace'
    ELSE 'late'
  END AS new_status
FROM attendance
ORDER BY date DESC;

-- ============================================================
-- Run the UPDATE after verifying the SELECT above looks correct
-- ============================================================

UPDATE attendance
SET clock_in_status = CASE
  WHEN (HOUR(CONVERT_TZ(clock_in, '+00:00', '+05:30')) * 60 + MINUTE(CONVERT_TZ(clock_in, '+00:00', '+05:30'))) <= (9 * 60 + 0) THEN 'on_time'
  WHEN (HOUR(CONVERT_TZ(clock_in, '+00:00', '+05:30')) * 60 + MINUTE(CONVERT_TZ(clock_in, '+00:00', '+05:30'))) <= (9 * 60 + 10) THEN 'grace'
  ELSE 'late'
END;

-- Confirm results
SELECT
  clock_in_status,
  COUNT(*) AS total
FROM attendance
GROUP BY clock_in_status;
