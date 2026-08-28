-- ═══════════════════════════════════════════════════════════════════════════════
-- Fix: Link existing content_write_requests to their calendar slots
-- 
-- Problem: Some content_write_requests were created without calendar_slot_id,
-- or the content_calendar_posts.linked_write_id wasn't set properly.
-- This causes the slot detail modal to not show filled content.
--
-- This migration links them back using linked_write_id on content_calendar_posts.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- POSTS: Fix content_write_requests ↔ content_calendar_posts linkage
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Where content_calendar_posts has linked_write_id but the write request
--    doesn't have calendar_slot_id set → fix the write request
UPDATE content_write_requests cwr
INNER JOIN content_calendar_posts cp ON cp.linked_write_id = cwr.id
SET cwr.calendar_slot_id = cp.id
WHERE cwr.calendar_slot_id IS NULL
  AND cwr.deleted = 0;

-- 2. Where content_calendar_posts has linked_brief_id but the write request
--    doesn't have calendar_slot_id set → fix the write request
UPDATE content_write_requests cwr
INNER JOIN content_calendar_posts cp ON cp.linked_brief_id = cwr.id
SET cwr.calendar_slot_id = cp.id
WHERE cwr.calendar_slot_id IS NULL
  AND cwr.deleted = 0;

-- 3. Where a content_write_request has calendar_slot_id but the post's
--    linked_write_id is not set → link it back
UPDATE content_calendar_posts cp
INNER JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id AND cwr.deleted = 0
SET cp.linked_write_id = cwr.id
WHERE cp.linked_write_id IS NULL;

-- 4. Try to match by project + created_by (assignee) + content_type + similar date
--    for records that have NO link at all
UPDATE content_write_requests cwr
INNER JOIN content_calendar_posts cp 
  ON cp.assigned_to = cwr.created_by
  AND cp.format = cwr.content_type
  AND cp.plan_id IN (
    SELECT p.id FROM content_calendar_plans p 
    WHERE p.project_id = cwr.project_id
  )
  AND cp.slot_status IN ('submitted', 'approved', 'completed')
  AND (cwr.hook_opening_line IS NOT NULL OR cwr.caption_content IS NOT NULL)
SET cwr.calendar_slot_id = cp.id
WHERE cwr.calendar_slot_id IS NULL
  AND cwr.deleted = 0
  AND cp.linked_write_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM content_write_requests cwr2 
    WHERE cwr2.calendar_slot_id = cp.id AND cwr2.deleted = 0
  );

-- 5. After step 4, also set linked_write_id on posts that got linked
UPDATE content_calendar_posts cp
INNER JOIN content_write_requests cwr ON cwr.calendar_slot_id = cp.id AND cwr.deleted = 0
SET cp.linked_write_id = cwr.id
WHERE cp.linked_write_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SHOOTS: Fix shoots ↔ content_calendar_shoots linkage
-- ═══════════════════════════════════════════════════════════════════════════════

-- 6. Where content_calendar_shoots has linked_shoot_ref_id but the shoot record
--    doesn't have calendar_slot_id set → fix the shoot
UPDATE shoots s
INNER JOIN content_calendar_shoots cs ON cs.linked_shoot_ref_id = s.id
SET s.calendar_slot_id = cs.id
WHERE s.calendar_slot_id IS NULL
  AND s.deleted = 0;

-- 7. Where a shoot has calendar_slot_id but the calendar slot's linked_shoot_ref_id
--    is not set → link it back
UPDATE content_calendar_shoots cs
INNER JOIN shoots s ON s.calendar_slot_id = cs.id AND s.deleted = 0
SET cs.linked_shoot_ref_id = s.id
WHERE cs.linked_shoot_ref_id IS NULL;

-- 8. For shoots with duplicate records per slot, keep only the one with actual content
--    (mark empty duplicates as deleted)
UPDATE shoots s
SET s.deleted = 1
WHERE s.calendar_slot_id IS NOT NULL
  AND s.deleted = 0
  AND s.project_campaign_name = 'TBD'
  AND s.exact_address IS NULL
  AND s.city IS NULL
  AND EXISTS (
    SELECT 1 FROM (
      SELECT calendar_slot_id FROM shoots 
      WHERE calendar_slot_id = s.calendar_slot_id AND deleted = 0
      GROUP BY calendar_slot_id HAVING COUNT(*) > 1
    ) dup
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- ADS: Fix ad_campaigns ↔ content_calendar_ads linkage
-- ═══════════════════════════════════════════════════════════════════════════════

-- 9. Where a content_calendar_ads has a linked ad campaign but linked_calendar_ad_id
--    is not set on the campaign → fix it
UPDATE ad_campaigns ac
INNER JOIN content_calendar_ads ca ON ca.id = ac.calendar_slot_id
SET ac.linked_calendar_ad_id = ca.id
WHERE ac.linked_calendar_ad_id IS NULL
  AND ac.deleted = 0
  AND ac.calendar_slot_id IS NOT NULL;
