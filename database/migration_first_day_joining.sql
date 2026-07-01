-- Migration: First Day Joining feature
-- Adds effective_clock_in to attendance and is_rejoining flag to users

-- 1. Add effective_clock_in to attendance table
--    Stores the shift-start time used for deficit calculation when FDJ reason is given.
--    NULL = use clock_in as-is (normal case).
ALTER TABLE `attendance`
  ADD COLUMN `effective_clock_in` DATETIME DEFAULT NULL AFTER `clock_in`;

-- 2. Add is_rejoining flag to users table
--    Set to 1 by admin when reactivating a returning employee.
--    Auto-cleared to 0 after their first clock-in.
ALTER TABLE `users`
  ADD COLUMN `is_rejoining` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`;
