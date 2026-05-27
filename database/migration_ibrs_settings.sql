USE crm_task_module;

-- ============================================================
-- IBRS (Initial Business Research Sheet) Templates per Industry
-- Admin configures IBRS content for each industry.
-- When a project is linked to a client with that industry,
-- the IBRS template is displayed within the project.
-- ============================================================

CREATE TABLE IF NOT EXISTS ibrs_templates (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  industry_id     INT UNSIGNED NOT NULL,
  title           VARCHAR(255) NOT NULL,
  content         LONGTEXT NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ibrs_industry FOREIGN KEY (industry_id) REFERENCES pitch_deck_industries(id) ON DELETE CASCADE
) ENGINE=InnoDB;
