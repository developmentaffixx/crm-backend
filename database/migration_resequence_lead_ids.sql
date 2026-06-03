-- ============================================================================
-- Migration: Re-sequence Lead IDs
-- Description: Renumbers all existing leads sequentially per month (YYMM).
--              Resets the lead_id_sequence table to match actual counts.
-- Run this ONCE to fix existing lead IDs after backdating.
-- ============================================================================

-- Step 1: Create a temporary table with new sequential lead IDs per month
DROP TEMPORARY TABLE IF EXISTS temp_lead_reseq;

CREATE TEMPORARY TABLE temp_lead_reseq AS
SELECT
  id,
  lead_id AS old_lead_id,
  created_at,
  CONCAT(
    'LD-',
    DATE_FORMAT(created_at, '%y%m%d'),
    '-',
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE_FORMAT(created_at, '%y%m')
        ORDER BY created_at ASC, id ASC
      ),
      3, '0'
    )
  ) AS new_lead_id
FROM leads
WHERE deleted = 0
ORDER BY created_at ASC, id ASC;

-- Step 2: Update leads with new sequential IDs
UPDATE leads l
JOIN temp_lead_reseq t ON l.id = t.id
SET l.lead_id = t.new_lead_id;

-- Step 3: Reset the lead_id_sequence table to match actual counts per month
DELETE FROM lead_id_sequence;

INSERT INTO lead_id_sequence (ym_key, last_seq)
SELECT
  DATE_FORMAT(created_at, '%y%m') AS ym_key,
  COUNT(*) AS last_seq
FROM leads
WHERE deleted = 0
GROUP BY DATE_FORMAT(created_at, '%y%m');

-- Step 4: Cleanup
DROP TEMPORARY TABLE IF EXISTS temp_lead_reseq;

-- Done! Verify with:
-- SELECT lead_id, name, created_at FROM leads WHERE deleted = 0 ORDER BY created_at;
-- SELECT * FROM lead_id_sequence;
