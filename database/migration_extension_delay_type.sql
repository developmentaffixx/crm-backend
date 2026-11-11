-- Extension requests: delay type (client / team / general) + selected options.
-- Also applied automatically on server start (src/config/ensureExtensionColumns.js).
ALTER TABLE task_deadline_extension_requests
  ADD COLUMN IF NOT EXISTS delay_type VARCHAR(20) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS delay_reasons TEXT NULL;
