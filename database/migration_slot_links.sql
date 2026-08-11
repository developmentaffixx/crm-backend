-- Link content_write_requests to content calendar post slots
ALTER TABLE content_write_requests
  ADD COLUMN IF NOT EXISTS calendar_slot_id INT NULL DEFAULT NULL
    REFERENCES content_calendar_posts(id) ON DELETE SET NULL;

-- Link shoots to content calendar shoot slots  
ALTER TABLE shoots
  ADD COLUMN IF NOT EXISTS calendar_slot_id INT NULL DEFAULT NULL
    REFERENCES content_calendar_shoots(id) ON DELETE SET NULL;

-- ad_campaigns already has linked_calendar_ad_id — no change needed
