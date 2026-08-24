-- Migration: Add explicit posting_date to content_write_requests
-- Allows a content write request to carry its own posting date, independent
-- of any linked content calendar slot.

ALTER TABLE content_write_requests
  ADD COLUMN posting_date DATE NULL AFTER content_type;

ALTER TABLE content_write_requests
  ADD INDEX idx_cwr_posting_date (posting_date);
