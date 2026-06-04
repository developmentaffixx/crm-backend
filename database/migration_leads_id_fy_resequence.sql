-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Resequence Lead IDs to Financial Year (Apr–Mar) numbering
-- Renumbers all leads in FY 2026-27 sequentially by created_at order
-- Format stays: LD-YYMMDD-XXX  (only the sequence number changes)
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Renumber all FY 2026-27 leads sequentially ordered by created_at
SET @seq = 0;

UPDATE leads
SET lead_id = CONCAT(
  'LD-',
  DATE_FORMAT(created_at, '%y%m%d'),
  '-',
  LPAD(@seq := @seq + 1, 3, '0')
)
WHERE deleted = 0
  AND created_at >= '2026-04-01'
  AND created_at < '2027-04-01'
ORDER BY created_at ASC;

-- Step 2: Sync the sequence counter table to match current count
INSERT INTO lead_id_sequence (ym_key, last_seq)
SELECT '2627', COUNT(*)
FROM leads
WHERE deleted = 0
  AND created_at >= '2026-04-01'
  AND created_at < '2027-04-01'
ON DUPLICATE KEY UPDATE last_seq = VALUES(last_seq);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify result (run this SELECT to check before committing)
-- SELECT id, lead_id, created_at FROM leads
-- WHERE deleted = 0 AND created_at >= '2026-04-01'
-- ORDER BY created_at ASC;
-- ─────────────────────────────────────────────────────────────────────────────
