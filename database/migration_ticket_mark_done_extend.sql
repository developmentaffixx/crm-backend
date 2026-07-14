-- ============================================================
-- Ticket Mark-as-Done & Deadline Extension Migration
-- Adds approval workflow (like tasks) and deadline extension requests for tickets
-- Run this against crm_task_module database
-- ============================================================

USE crm_task_module;

-- 1. Add 'pending_done' to the ticket status ENUM
ALTER TABLE tickets
  MODIFY COLUMN status ENUM('open','in_progress','hold','pending_done','resolved','closed') NOT NULL DEFAULT 'open';

-- 2. Add marked_done_by column to track who marked it done
ALTER TABLE tickets
  ADD COLUMN marked_done_by INT UNSIGNED DEFAULT NULL AFTER closed_at,
  ADD COLUMN marked_done_at DATETIME DEFAULT NULL AFTER marked_done_by,
  ADD CONSTRAINT fk_tickets_marked_done_by FOREIGN KEY (marked_done_by) REFERENCES users(id) ON DELETE SET NULL;

-- 3. Create ticket_deadline_extension_requests table
CREATE TABLE IF NOT EXISTS ticket_deadline_extension_requests (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id          INT UNSIGNED NOT NULL,
  requested_by       INT UNSIGNED NOT NULL,
  requested_deadline DATE NOT NULL,
  reason             TEXT,
  status             ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  actioned_by        INT UNSIGNED DEFAULT NULL,
  deleted            TINYINT(1) NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tder_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tder_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_tder_actioned_by FOREIGN KEY (actioned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Index for quick lookups
CREATE INDEX idx_tder_ticket ON ticket_deadline_extension_requests (ticket_id);
CREATE INDEX idx_tder_status ON ticket_deadline_extension_requests (status);
