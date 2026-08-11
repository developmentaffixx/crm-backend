-- Add reschedule_reason column to content calendar tables
ALTER TABLE content_calendar_posts
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT NULL AFTER posting_date;

ALTER TABLE content_calendar_shoots
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT NULL AFTER shoot_date;

ALTER TABLE content_calendar_ads
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT NULL AFTER start_date;
