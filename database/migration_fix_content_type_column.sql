-- Fix content_type column in content_write_requests
-- Change from restrictive ENUM to VARCHAR to support new content type values
-- Also update existing enum values to match current frontend values

-- Step 1: Change column type from ENUM to VARCHAR
ALTER TABLE content_write_requests
  MODIFY COLUMN content_type VARCHAR(50) DEFAULT NULL;

-- Step 2: Update old enum values to new format
UPDATE content_write_requests SET content_type = 'reel' WHERE content_type = 'reel_video_script';
UPDATE content_write_requests SET content_type = 'blog_article' WHERE content_type = 'blog_article';
UPDATE content_write_requests SET content_type = 'email_newsletter' WHERE content_type = 'email_newsletter';

-- Step 3: Also remove NOT NULL constraints on deadline, platform, service_type
-- since newer code paths don't always require them
ALTER TABLE content_write_requests
  MODIFY COLUMN deadline DATE DEFAULT NULL;

ALTER TABLE content_write_requests
  MODIFY COLUMN platform VARCHAR(100) DEFAULT NULL;

ALTER TABLE content_write_requests
  MODIFY COLUMN service_type VARCHAR(100) DEFAULT NULL;
