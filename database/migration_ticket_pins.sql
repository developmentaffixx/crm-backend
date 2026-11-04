-- ============================================================
-- Ticket Pins — per-user pinned tickets (max 3), mirrors task_pins
-- ============================================================

USE crm_task_module;

CREATE TABLE IF NOT EXISTS ticket_pins (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id   INT UNSIGNED NOT NULL,
  ticket_id INT UNSIGNED NOT NULL,
  pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_ticket_pin (user_id, ticket_id),
  CONSTRAINT fk_ticket_pins_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_ticket_pins_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX idx_ticket_pins_user (user_id)
) ENGINE=InnoDB;
