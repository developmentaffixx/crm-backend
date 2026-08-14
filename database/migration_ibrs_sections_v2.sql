USE crm_task_module;

-- ============================================================
-- IBRS v2: Section-based (Title + Description) per Industry
-- Replaces the document-upload approach.
-- Each row = one IBRS config for an industry, with sections stored as JSON.
-- ============================================================

-- Drop old columns that are no longer needed
ALTER TABLE ibrs_templates
  DROP COLUMN IF EXISTS file_url,
  DROP COLUMN IF EXISTS cloudinary_id,
  DROP COLUMN IF EXISTS file_type;

-- Ensure 'name' column exists (might already from previous migration)
-- ALTER TABLE ibrs_templates ADD COLUMN name VARCHAR(255) DEFAULT NULL AFTER industry_id;

-- Add sections column (JSON array of {title, description})
ALTER TABLE ibrs_templates
  ADD COLUMN sections JSON DEFAULT NULL AFTER name;

-- Update content_type enum to include 'sections'
ALTER TABLE ibrs_templates
  MODIFY COLUMN content_type ENUM('text', 'code', 'document', 'sections') NOT NULL DEFAULT 'sections';
