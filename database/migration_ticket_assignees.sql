USE crm_task_module;

-- ============================================================
-- Ticket Collaborators Migration
-- Mirrors task_assignees: multi-assignee support for tickets.
-- `assigned_to` remains on the tickets table for the primary assignee.
-- ============================================================

-- ------------------------------------------------------------
-- Multi-Assignee Junction Table (primary + collaborators)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_assignees (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id  INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       ENUM('primary', 'collaborator') NOT NULL DEFAULT 'collaborator',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ticket_assignee_user (ticket_id, user_id),
  CONSTRAINT fk_ticket_assignees_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_assignees_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Backfill ticket_assignees from existing assigned_to data
-- (Run once to populate primary assignees for existing tickets)
-- ------------------------------------------------------------
INSERT IGNORE INTO ticket_assignees (ticket_id, user_id, role)
SELECT id, assigned_to, 'primary' FROM tickets WHERE deleted = 0 AND assigned_to IS NOT NULL;
