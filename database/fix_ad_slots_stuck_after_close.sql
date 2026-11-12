-- ============================================================
-- Fix: Ad slots stuck at 'approved' after "Close & Report"
-- Cause: saveReport tried to set completed_at / completed_by on
-- content_calendar_ads, which did not exist, so the slot update failed silently.
-- ============================================================

USE crm_task_module;

-- 1. Add the missing columns
ALTER TABLE content_calendar_ads
  ADD COLUMN IF NOT EXISTS completed_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_by INT UNSIGNED DEFAULT NULL;

-- 2. Mark slots completed where the linked campaign is already completed,
--    and copy the report's amount spent / notes onto the slot.
UPDATE content_calendar_ads ca
INNER JOIN ad_campaigns ac
  ON (ac.linked_calendar_ad_id = ca.id OR ac.calendar_slot_id = ca.id)
 AND ac.deleted = 0
LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
SET ca.slot_status  = 'completed',
    ca.completed_at = COALESCE(ca.completed_at, acr.updated_at, NOW()),
    ca.amount_spent = COALESCE(acr.amount_spent, ca.amount_spent),
    ca.report_notes = COALESCE(acr.recommendations, acr.best_performing_ad, ca.report_notes)
WHERE ac.status = 'completed'
  AND ca.slot_status <> 'completed';
