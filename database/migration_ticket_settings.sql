-- ─────────────────────────────────────────────────────────────────────────────
-- Ticket Settings (single-row config table)
-- Mirrors task_settings; controls ticket approval behaviour.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ticket_settings (
  id                            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Master switch: when OFF, "Mark as Done" resolves tickets immediately
  -- (no pending_done / approval step) and extension requests auto-approve.
  require_approval_completion   TINYINT(1) NOT NULL DEFAULT 1,
  -- When ON, deadline extension requests must be approved; when OFF they apply directly.
  require_approval_extension    TINYINT(1) NOT NULL DEFAULT 1,
  updated_at                    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed the single config row
INSERT IGNORE INTO ticket_settings (id) VALUES (1);
