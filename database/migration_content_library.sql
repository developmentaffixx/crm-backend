-- Stored (library) content on the Contents page.
-- Library rows have is_library = 1, no calendar_slot_id, project or cycle.
-- They never appear on the calendar. "Move to slot" copies their fields into
-- the slot's content row and leaves the library row unchanged.
-- (Also applied automatically at server start by ensureContentWorkflowSchema.)

ALTER TABLE content_write_requests
  ADD COLUMN IF NOT EXISTS is_library TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE content_write_requests
  ADD INDEX IF NOT EXISTS idx_cwr_library (is_library);
