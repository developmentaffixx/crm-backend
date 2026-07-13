-- Fix: Allow topic to be NULL in content_calendar_posts
-- Error: Column 'topic' cannot be null
ALTER TABLE content_calendar_posts MODIFY COLUMN topic TEXT DEFAULT NULL;
