-- Remove today's clock-in for one employee so they can clock in again.
-- Replace <USER_ID> with the employee's id (users.id).

-- 1) Check the row first
SELECT * FROM attendance
WHERE user_id = <USER_ID> AND date = CURDATE();

-- 2) Delete it (one row per user per day)
DELETE FROM attendance
WHERE user_id = <USER_ID> AND date = CURDATE();
