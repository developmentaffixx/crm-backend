USE crm_task_module;

-- ============================================================
-- Lead SWOT Notes (single freeform paragraph per lead)
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_swot_notes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id     INT UNSIGNED NOT NULL UNIQUE,
  notes       TEXT NOT NULL,
  updated_by  INT UNSIGNED NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lead_swot_notes_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_swot_notes_user FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB;
