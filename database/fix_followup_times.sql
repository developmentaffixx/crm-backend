-- ============================================================
-- Fix lead_follow_ups: Delete test entries & correct timestamps
-- ============================================================

-- 1. Delete "Checking" and "Checking 2" test entries
DELETE FROM lead_follow_ups WHERE id IN (9, 10);

-- 2. Fix entries with 00:00:00 time (date was stored without time)
-- Using follow_up_date time where available, otherwise 10:00:00 default

-- ID 1: follow_up_date = 2026-05-27 10:20:00 → set created_at time to 10:20:00
UPDATE lead_follow_ups SET created_at = '2026-05-25 10:20:00' WHERE id = 1;

-- ID 2: follow_up_date = 2026-05-30 11:00:00 → set created_at time to 11:00:00
UPDATE lead_follow_ups SET created_at = '2026-05-27 11:00:00' WHERE id = 2;

-- ID 3: follow_up_date = 2026-06-01 10:30:00 → set created_at time to 10:30:00
UPDATE lead_follow_ups SET created_at = '2026-05-30 10:30:00' WHERE id = 3;

-- ID 4: follow_up_date = 2026-06-02 10:00:00 → set created_at time to 10:00:00
UPDATE lead_follow_ups SET created_at = '2026-06-01 10:00:00' WHERE id = 4;

-- ID 5: follow_up_date = 2026-06-04 11:00:00 → set created_at time to 11:00:00
UPDATE lead_follow_ups SET created_at = '2026-06-02 11:00:00' WHERE id = 5;

-- ID 7: follow_up_date = 2026-06-06 12:05:00 → set created_at time to 12:05:00
UPDATE lead_follow_ups SET created_at = '2026-06-04 12:05:00' WHERE id = 7;

-- ID 8: follow_up_date = NULL → use 10:00:00 default
UPDATE lead_follow_ups SET created_at = '2026-06-04 10:00:00' WHERE id = 8;

-- ID 17: follow_up_date = 2026-06-11 12:22:00 → set created_at time to 12:22:00
UPDATE lead_follow_ups SET created_at = '2026-06-12 12:22:00' WHERE id = 17;

-- ID 18: follow_up_date = 2026-06-11 15:00:00 → set created_at time to 15:00:00
UPDATE lead_follow_ups SET created_at = '2026-06-12 15:00:00' WHERE id = 18;

-- ID 19: follow_up_date = 2026-06-12 14:15:00 → set created_at time to 14:15:00
UPDATE lead_follow_ups SET created_at = '2026-06-12 14:15:00' WHERE id = 19;

-- ID 20: follow_up_date = 2026-06-11 11:26:00 → set created_at time to 11:26:00
UPDATE lead_follow_ups SET created_at = '2026-06-12 11:26:00' WHERE id = 20;

-- ID 21: follow_up_date = 2026-07-01 13:31:00 → set created_at time to 10:00:00 (future follow-up, use default)
UPDATE lead_follow_ups SET created_at = '2026-06-12 10:00:00' WHERE id = 21;

-- 3. Fix UTC offset entries (stored in UTC, should be IST = UTC + 5:30)

-- ID 13: 2026-06-08 07:47:02 → 2026-06-08 13:17:02
UPDATE lead_follow_ups SET created_at = '2026-06-08 13:17:02' WHERE id = 13;

-- ID 15: 2026-06-12 03:37:30 → 2026-06-12 09:07:30
UPDATE lead_follow_ups SET created_at = '2026-06-12 09:07:30' WHERE id = 15;

-- ID 16: 2026-06-12 03:44:00 → 2026-06-12 09:14:00
UPDATE lead_follow_ups SET created_at = '2026-06-12 09:14:00' WHERE id = 16;

-- ============================================================
-- Done! Verify with: SELECT id, lead_id, type, created_at FROM lead_follow_ups ORDER BY id;
-- ============================================================
