USE crm_task_module;

-- ============================================================
-- Content Calendar - Slot Pickup + Approval + Client Sharing
-- ============================================================

-- ─── Posts: Add slot pickup & approval columns ────────────────────────────────

ALTER TABLE content_calendar_posts
  ADD COLUMN assigned_to INT UNSIGNED DEFAULT NULL AFTER plan_id,
  ADD COLUMN slot_status ENUM('open','picked_up','pending_approval','approved','rejected') NOT NULL DEFAULT 'open' AFTER status,
  ADD COLUMN rejection_reason TEXT DEFAULT NULL AFTER slot_status,
  ADD COLUMN submitted_at DATETIME DEFAULT NULL AFTER rejection_reason,
  ADD COLUMN approved_at DATETIME DEFAULT NULL AFTER submitted_at,
  ADD COLUMN approved_by INT UNSIGNED DEFAULT NULL AFTER approved_at;

ALTER TABLE content_calendar_posts
  ADD INDEX idx_ccp_assigned (assigned_to),
  ADD INDEX idx_ccp_slot_status (slot_status);

-- ─── Shoots: Add slot pickup & approval columns ──────────────────────────────

ALTER TABLE content_calendar_shoots
  ADD COLUMN assigned_to INT UNSIGNED DEFAULT NULL AFTER plan_id,
  ADD COLUMN slot_status ENUM('open','picked_up','pending_approval','approved','rejected') NOT NULL DEFAULT 'open' AFTER status,
  ADD COLUMN rejection_reason TEXT DEFAULT NULL AFTER slot_status,
  ADD COLUMN submitted_at DATETIME DEFAULT NULL AFTER rejection_reason,
  ADD COLUMN approved_at DATETIME DEFAULT NULL AFTER submitted_at,
  ADD COLUMN approved_by INT UNSIGNED DEFAULT NULL AFTER approved_at;

ALTER TABLE content_calendar_shoots
  ADD INDEX idx_ccs_assigned (assigned_to),
  ADD INDEX idx_ccs_slot_status (slot_status);

-- ─── Ads: Add slot pickup & approval columns ─────────────────────────────────

ALTER TABLE content_calendar_ads
  ADD COLUMN assigned_to INT UNSIGNED DEFAULT NULL AFTER plan_id,
  ADD COLUMN slot_status ENUM('open','picked_up','pending_approval','approved','rejected') NOT NULL DEFAULT 'open' AFTER ad_status,
  ADD COLUMN rejection_reason TEXT DEFAULT NULL AFTER slot_status,
  ADD COLUMN submitted_at DATETIME DEFAULT NULL AFTER rejection_reason,
  ADD COLUMN approved_at DATETIME DEFAULT NULL AFTER submitted_at,
  ADD COLUMN approved_by INT UNSIGNED DEFAULT NULL AFTER approved_at;

ALTER TABLE content_calendar_ads
  ADD INDEX idx_cca_assigned (assigned_to),
  ADD INDEX idx_cca_slot_status (slot_status);

-- ─── Plans: Add client sharing columns ────────────────────────────────────────

ALTER TABLE content_calendar_plans
  ADD COLUMN shared_with_client TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN shared_at DATETIME DEFAULT NULL AFTER shared_with_client,
  ADD COLUMN shared_by INT UNSIGNED DEFAULT NULL AFTER shared_at;

ALTER TABLE content_calendar_plans
  ADD INDEX idx_ccplan_shared (shared_with_client);
