-- ============================================================
-- Daily Journal (SMM Daily Project Update) - MySQL Schema
-- ============================================================

USE crm_task_module;

CREATE TABLE IF NOT EXISTS smm_daily_journal (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id            INT UNSIGNED NOT NULL,
  journal_date          DATE NOT NULL,
  submitted_by          INT UNSIGNED NOT NULL,

  -- Activities Completed (stored as JSON array of checked items)
  activities_completed  JSON DEFAULT NULL,

  -- Today's Key Activities (free text)
  key_activities        TEXT DEFAULT NULL,

  -- Client Communication Today
  client_communication  ENUM('yes','no') DEFAULT 'no',
  communication_summary TEXT DEFAULT NULL,

  -- Issues / Delays (stored as JSON array of checked issues)
  issues_delays         JSON DEFAULT NULL,
  issues_details        TEXT DEFAULT NULL,

  -- Approvals Pending (free text)
  approvals_pending     TEXT DEFAULT NULL,

  -- Leads / Opportunities Identified (free text)
  leads_opportunities   TEXT DEFAULT NULL,

  -- Tomorrow's Priorities (JSON array of up to 3 strings)
  tomorrow_priorities   JSON DEFAULT NULL,

  -- Escalation
  escalation_required   ENUM('yes','no') DEFAULT 'no',
  escalation_details    TEXT DEFAULT NULL,

  -- Project Health Status
  health_status         ENUM('on_track','attention_needed','critical') DEFAULT 'on_track',

  -- Timestamps
  submitted_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_sdj_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sdj_user    FOREIGN KEY (submitted_by) REFERENCES users(id),
  UNIQUE KEY uq_journal_entry (project_id, journal_date, submitted_by)
) ENGINE=InnoDB;
