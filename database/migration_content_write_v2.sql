-- Migration: Update content_write_requests for project-based workflow
-- Adds project_id, service_id, caption_content, creative_suggestion columns

ALTER TABLE content_write_requests
  ADD COLUMN project_id INT NULL AFTER client_brand_id,
  ADD COLUMN service_id INT NULL AFTER project_id,
  ADD COLUMN caption_content TEXT NULL AFTER reference_links,
  ADD COLUMN creative_suggestion TEXT NULL AFTER caption_content;

-- Add index for project lookups
ALTER TABLE content_write_requests ADD INDEX idx_cwr_project_id (project_id);
