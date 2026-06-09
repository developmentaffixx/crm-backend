-- ============================================================
-- FIX: Undo accidental auto clock-out on June 9, 2025
-- Run this BEFORE restarting the server
-- ============================================================

-- 1. Re-open attendance records that were auto-clocked-out today
UPDATE attendance
SET clock_out = NULL,
    total_served_seconds = NULL,
    auto_clock_out = 0
WHERE date = CURDATE()
  AND auto_clock_out = 1;

-- 2. Restore task timers from time logs that were auto-stopped today
-- (Re-insert active timers from logs marked as auto-stopped today)
INSERT INTO task_active_timers (task_id, user_id, started_at)
SELECT tl.task_id, tl.user_id, tl.started_at
FROM task_time_logs tl
WHERE tl.note = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(tl.ended_at) = CURDATE();

-- 3. Revert task time_spent that was added by auto clock-out
UPDATE tasks t
JOIN task_time_logs tl ON tl.task_id = t.id
SET t.time_spent = t.time_spent - tl.duration
WHERE tl.note = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(tl.ended_at) = CURDATE();

-- 4. Delete the incorrect auto-generated task time logs
DELETE FROM task_time_logs
WHERE note = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(ended_at) = CURDATE();

-- 5. Restore ticket timers (if any were deleted)
-- Note: The cron's ticket_time_logs INSERT used wrong column name 'note' 
-- so it likely failed and ticket_active_timers may still be intact.
-- This step is a safety net - it will do nothing if no matching records exist.
INSERT IGNORE INTO ticket_active_timers (ticket_id, user_id, started_at)
SELECT ttl.ticket_id, ttl.user_id, DATE_SUB(ttl.created_at, INTERVAL ttl.minutes MINUTE)
FROM ticket_time_logs ttl
WHERE ttl.description = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(ttl.created_at) = CURDATE();

-- 6. Delete incorrect ticket time logs (if any exist)
DELETE FROM ticket_time_logs
WHERE description = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(created_at) = CURDATE();

-- 7. Restore meeting timers
INSERT INTO meeting_active_timers (meeting_id, user_id, started_at)
SELECT mtl.meeting_id, mtl.user_id, mtl.started_at
FROM meeting_time_logs mtl
WHERE mtl.note = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(mtl.ended_at) = CURDATE();

-- 8. Delete incorrect meeting time logs
DELETE FROM meeting_time_logs
WHERE note = 'Auto-stopped by system (forgot to clock out)'
  AND DATE(ended_at) = CURDATE();

-- 9. Restore AFS sessions that were ended today by auto clock-out
UPDATE afs_logs
SET end_time = NULL, duration_seconds = NULL
WHERE DATE(end_time) = CURDATE()
  AND end_time = '2025-06-09 13:30:00';  -- The auto clock-out sets 13:30 UTC

-- NOTE: After running this, restart the server. The fixed catch-up logic
-- will no longer clock out today's users on restart.
