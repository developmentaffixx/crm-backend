USE crm_task_module;

-- ============================================================
-- Leads Module v3 - Status history + Lead ID sequence fix
-- ============================================================

-- ------------------------------------------------------------
-- Lead status change history (audit trail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_status_history (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id     INT UNSIGNED NOT NULL,
  old_status  VARCHAR(50) NOT NULL,
  new_status  VARCHAR(50) NOT NULL,
  changed_by  INT UNSIGNED NOT NULL,
  changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lsh_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lsh_user FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Lead ID sequence table (prevents race condition)
-- Uses a single-row counter per month to safely generate IDs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_id_sequence (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym_key      VARCHAR(6) NOT NULL,  -- e.g. '2506' for June 2025
  last_seq    INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uk_ym_key (ym_key)
) ENGINE=InnoDB;
