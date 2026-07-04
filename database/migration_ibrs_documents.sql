-- Add document upload fields to ibrs_templates
-- Replaces the text/code content with uploaded documents

ALTER TABLE ibrs_templates
  ADD COLUMN file_url TEXT DEFAULT NULL AFTER content_type,
  ADD COLUMN cloudinary_id VARCHAR(500) DEFAULT NULL AFTER file_url,
  ADD COLUMN file_type VARCHAR(50) DEFAULT NULL AFTER cloudinary_id,
  ADD COLUMN name VARCHAR(255) DEFAULT NULL AFTER industry_id;
