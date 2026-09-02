-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: sync content_calendar_posts.slot_status for write requests that are
--      already 'approved' but whose linked slot still shows 'submitted'.
--
-- Run this ONCE after deploying the backend fix.
-- Safe to run multiple times (WHERE clause limits to actual desyncs only).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Backfill calendar_slot_id on write requests that are missing it
--         (using linked_brief_id on the calendar post side)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE content_write_requests cwr
INNER JOIN content_calendar_posts cp ON cp.linked_brief_id = cwr.id
SET cwr.calendar_slot_id = cp.id
WHERE cwr.calendar_slot_id IS NULL
  AND cwr.deleted = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Backfill linked_brief_id on calendar posts that are missing it
--         (using calendar_slot_id on the write request side)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE content_calendar_posts cp
INNER JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id AND cwr.deleted = 0
SET cp.linked_brief_id = cwr.id
WHERE cp.linked_brief_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Fuzzy match — for records where BOTH link columns are still NULL,
--         match by project + posting_date + format (content_type).
--         This fixes Chandra Sarees and any other client in the same situation.
--
--         Conditions to keep it safe:
--           - Only one write request per slot (no ambiguous match)
--           - Slot must be in submitted/approved state (has content)
--           - Write request must have content (hook or caption not null)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. Set calendar_slot_id on the write request
UPDATE content_write_requests cwr
INNER JOIN content_calendar_posts cp
  ON  cp.posting_date  = DATE(COALESCE(cwr.posting_date, cwr.created_at))
  AND cp.format        = cwr.content_type
  AND cp.plan_id IN (
        SELECT p.id FROM content_calendar_plans p
        WHERE p.project_id = cwr.project_id
          AND p.deleted = 0
      )
  AND cp.slot_status IN ('submitted', 'approved', 'completed')
  AND (cwr.hook_opening_line IS NOT NULL OR cwr.caption_content IS NOT NULL)
SET cwr.calendar_slot_id = cp.id
WHERE cwr.calendar_slot_id IS NULL
  AND cwr.deleted = 0
  -- safety: only match if no other write request is already linked to this slot
  AND NOT EXISTS (
    SELECT 1 FROM content_write_requests cwr2
    WHERE cwr2.calendar_slot_id = cp.id
      AND cwr2.deleted = 0
  );

-- 3b. Set linked_brief_id on the calendar post (after 3a linked them)
UPDATE content_calendar_posts cp
INNER JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id AND cwr.deleted = 0
SET cp.linked_brief_id = cwr.id
WHERE cp.linked_brief_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Now sync slot_status = 'approved' for all write requests
--         that are approved but whose slot is still showing 'submitted'
-- ─────────────────────────────────────────────────────────────────────────────

-- 4a. Via calendar_slot_id
UPDATE content_calendar_posts cp
JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id
SET
  cp.slot_status      = 'approved',
  cp.approved_at      = cwr.approved_at,
  cp.approved_by      = cwr.approved_by,
  cp.rejection_reason = NULL
WHERE cwr.status   = 'approved'
  AND cwr.deleted  = 0
  AND cp.slot_status != 'approved';

-- 4b. Via linked_brief_id (catches any remaining)
UPDATE content_calendar_posts cp
JOIN content_write_requests cwr ON cp.linked_brief_id = cwr.id
SET
  cp.slot_status      = 'approved',
  cp.approved_at      = cwr.approved_at,
  cp.approved_by      = cwr.approved_by,
  cp.rejection_reason = NULL
WHERE cwr.status   = 'approved'
  AND cwr.deleted  = 0
  AND cp.slot_status != 'approved';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — run these SELECTs after to confirm everything is linked
-- ─────────────────────────────────────────────────────────────────────────────

-- Check remaining orphan write requests (should be 0 after this script)
-- SELECT cwr.id, cwr.content_id_code, cwr.status, cwr.calendar_slot_id, cwr.posting_date
-- FROM content_write_requests cwr
-- WHERE cwr.calendar_slot_id IS NULL
--   AND cwr.deleted = 0
--   AND cwr.status IN ('approved','pending');

-- Check slots still desynced from their write request
-- SELECT cp.id, cp.slot_status, cwr.status AS write_status, cwr.content_id_code
-- FROM content_calendar_posts cp
-- JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id
-- WHERE cwr.status = 'approved'
--   AND cp.slot_status != 'approved';
