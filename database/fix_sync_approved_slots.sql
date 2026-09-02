-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: sync content_calendar_posts.slot_status for write requests that are
--      already 'approved' but whose linked slot still shows 'submitted'.
--
-- Run this ONCE after deploying the backend fix.
-- Safe to run multiple times (WHERE clause limits to actual desyncs only).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Fix via calendar_slot_id (original link column)
UPDATE content_calendar_posts cp
JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id
SET
  cp.slot_status   = 'approved',
  cp.approved_at   = cwr.approved_at,
  cp.approved_by   = cwr.approved_by,
  cp.rejection_reason = NULL
WHERE cwr.status   = 'approved'
  AND cwr.deleted  = 0
  AND cp.slot_status != 'approved';

-- 2. Fix via linked_brief_id (newer link column set during submit)
UPDATE content_calendar_posts cp
JOIN content_write_requests cwr ON cp.linked_brief_id = cwr.id
SET
  cp.slot_status   = 'approved',
  cp.approved_at   = cwr.approved_at,
  cp.approved_by   = cwr.approved_by,
  cp.rejection_reason = NULL
WHERE cwr.status   = 'approved'
  AND cwr.deleted  = 0
  AND cp.slot_status != 'approved';

-- 3. Also set linked_brief_id for any slots that have calendar_slot_id set
--    but linked_brief_id is still NULL (backfill the join column)
UPDATE content_calendar_posts cp
JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id
SET cp.linked_brief_id = cwr.id
WHERE cp.linked_brief_id IS NULL
  AND cwr.deleted = 0;
