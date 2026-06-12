USE crm_task_module;

-- ============================================================
-- Lead SWOT (Strength, Weakness, Opportunities) Talk Points
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_swot (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id     INT UNSIGNED NOT NULL,
  category    ENUM('strength', 'weakness', 'opportunity') NOT NULL,
  point       TEXT NOT NULL,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lead_swot_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_swot_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
