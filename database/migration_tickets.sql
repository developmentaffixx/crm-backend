USE crm_task_module;

-- ============================================================
-- Tickets Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Tickets table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mode                ENUM('support','work') NOT NULL DEFAULT 'support',
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  ticket_type         ENUM('Client Issue','Finance Issue','General Request','General Support','HR Issue','Internal Team Issue','Technical / CRM Issue') NOT NULL DEFAULT 'General Request',
  priority            ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status              ENUM('open','in_progress','hold','resolved','closed') NOT NULL DEFAULT 'open',

  -- Related To
  related_to_type     ENUM('client','employee','vendor','internal_system') DEFAULT NULL,
  related_to_id       INT UNSIGNED DEFAULT NULL,       -- client_id or user_id (employee)
  vendor_name         VARCHAR(200) DEFAULT NULL,       -- free text for vendor
  brand_id            INT UNSIGNED DEFAULT NULL,       -- client's lead id (brand)
  project_id          INT UNSIGNED DEFAULT NULL,       -- project under that client

  -- Assignment
  assigned_to         INT UNSIGNED DEFAULT NULL,
  reported_by         INT UNSIGNED NOT NULL,
  due_date            DATE DEFAULT NULL,

  -- Notes & Resolution
  internal_notes      TEXT,
  resolution_summary  TEXT,

  -- Time tracking (work mode)
  total_time_minutes  INT UNSIGNED NOT NULL DEFAULT 0,

  -- Soft delete
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at         DATETIME DEFAULT NULL,
  closed_at           DATETIME DEFAULT NULL,

  CONSTRAINT fk_tickets_assigned  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_reported  FOREIGN KEY (reported_by) REFERENCES users(id),
  CONSTRAINT fk_tickets_project   FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Ticket attachments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  file_type   VARCHAR(50) NOT NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ta_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_user   FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Ticket activity log (audit trail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_activity_log (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  action      VARCHAR(50) NOT NULL,   -- status_change, assignment, comment, time_log, created, updated
  old_value   VARCHAR(255) DEFAULT NULL,
  new_value   VARCHAR(255) DEFAULT NULL,
  comment     TEXT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tal_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tal_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Ticket time logs (for Work mode)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_time_logs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  minutes     INT UNSIGNED NOT NULL DEFAULT 0,
  description VARCHAR(500) DEFAULT NULL,
  log_date    DATE NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ttl_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ttl_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB;
