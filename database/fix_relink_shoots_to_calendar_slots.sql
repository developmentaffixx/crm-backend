-- ============================================================================
-- One-time repair: re-link shoots to their Content Calendar slot.
--
-- Before the fix, saving a calendar plan deleted and re-inserted every shoot
-- slot, so shoots.calendar_slot_id kept pointing at slot ids that no longer
-- exist. This script re-links each such shoot to the slot in its cycle's plan
-- that has the same shoot date and no shoot linked yet.
--
-- Run the SELECTs first and review the output. Take a backup before the UPDATEs.
-- ============================================================================

-- 1. Shoots whose calendar slot no longer exists
SELECT s.id, s.shoot_id_code, s.status, s.cycle_id, s.shoot_date, s.calendar_slot_id AS missing_slot_id
FROM shoots s
LEFT JOIN content_calendar_shoots cs ON cs.id = s.calendar_slot_id
WHERE s.deleted = 0 AND s.calendar_slot_id IS NOT NULL AND cs.id IS NULL
ORDER BY s.id;

-- 2. Proposed matches (cycle plan + same date + slot not linked to another shoot)
SELECT s.id AS shoot_id, s.shoot_id_code, s.shoot_date, cs.id AS new_slot_id, cs.plan_id
FROM shoots s
LEFT JOIN content_calendar_shoots old ON old.id = s.calendar_slot_id
JOIN content_calendar_plans p ON p.cycle_id = s.cycle_id AND p.deleted = 0
JOIN content_calendar_shoots cs ON cs.plan_id = p.id AND cs.shoot_date = s.shoot_date
WHERE s.deleted = 0 AND s.calendar_slot_id IS NOT NULL AND old.id IS NULL
  AND cs.id NOT IN (
    SELECT x.slot_id FROM (
      SELECT calendar_slot_id AS slot_id FROM shoots WHERE deleted = 0 AND calendar_slot_id IS NOT NULL
    ) x
  )
ORDER BY s.id, cs.id;
-- If one shoot shows two candidate slots (two slots on the same date), fix that
-- shoot by hand: UPDATE shoots SET calendar_slot_id = <slot id> WHERE id = <shoot id>;

-- 3. Re-link (picks the lowest free slot id per shoot)
UPDATE shoots s
JOIN (
  SELECT s2.id AS shoot_id, MIN(cs.id) AS new_slot_id
  FROM shoots s2
  LEFT JOIN content_calendar_shoots old ON old.id = s2.calendar_slot_id
  JOIN content_calendar_plans p ON p.cycle_id = s2.cycle_id AND p.deleted = 0
  JOIN content_calendar_shoots cs ON cs.plan_id = p.id AND cs.shoot_date = s2.shoot_date
  WHERE s2.deleted = 0 AND s2.calendar_slot_id IS NOT NULL AND old.id IS NULL
    AND cs.id NOT IN (
      SELECT x.slot_id FROM (
        SELECT calendar_slot_id AS slot_id FROM shoots WHERE deleted = 0 AND calendar_slot_id IS NOT NULL
      ) x
    )
  GROUP BY s2.id
) m ON m.shoot_id = s.id
SET s.calendar_slot_id = m.new_slot_id;

-- 4. Make the re-linked slots show the shoot's real status
UPDATE content_calendar_shoots cs
JOIN shoots s ON s.calendar_slot_id = cs.id AND s.deleted = 0
SET cs.linked_shoot_ref_id = s.id,
    cs.slot_status = CASE s.status
      WHEN 'pending_approval'   THEN 'submitted'
      WHEN 'rejected'           THEN 'rejected'
      WHEN 'approved'           THEN 'approved'
      WHEN 'pending_completion' THEN 'approved'
      WHEN 'completed'          THEN 'completed'
      ELSE cs.slot_status
    END
WHERE s.status <> 'draft'
  AND (cs.linked_shoot_ref_id IS NULL OR cs.slot_status IN ('open', 'assigned'));

-- 5. Still broken after the repair (no matching slot): review these by hand
SELECT s.id, s.shoot_id_code, s.status, s.cycle_id, s.shoot_date, s.calendar_slot_id
FROM shoots s
LEFT JOIN content_calendar_shoots cs ON cs.id = s.calendar_slot_id
WHERE s.deleted = 0 AND s.calendar_slot_id IS NOT NULL AND cs.id IS NULL
ORDER BY s.id;
