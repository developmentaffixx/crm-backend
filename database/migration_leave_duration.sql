-- Migration: Add duration column to leaves table for half-day support
-- Values: 'full_day', 'first_half', 'second_half'

ALTER TABLE leaves
  ADD COLUMN duration ENUM('full_day','first_half','second_half') NOT NULL DEFAULT 'full_day' AFTER to_date;
