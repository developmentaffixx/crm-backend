USE crm_task_module;

-- ============================================================
-- Sales Meetings
-- Tracks meetings booked by sales reps, tied to leads.
-- Each meeting has a date + slot (morning/afternoon/evening).
-- Pre/post confirmation and follow-up outcome are stored here
-- AND auto-synced to lead_follow_ups.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_meetings (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Link to lead (optional at creation — can attach later)
  lead_id               INT UNSIGNED DEFAULT NULL,

  -- Who booked this meeting
  created_by            INT UNSIGNED NOT NULL,

  -- Date and time slot
  meeting_date          DATE NOT NULL,
  slot                  ENUM('morning','afternoon','evening') NOT NULL,

  -- Mode
  mode                  ENUM('online','offline') DEFAULT 'online',

  -- Title / notes
  title                 VARCHAR(255) DEFAULT NULL,
  notes                 TEXT DEFAULT NULL,

  -- Pre-meeting confirmation
  pre_confirmed         TINYINT(1) DEFAULT 0,
  pre_confirmed_at      DATETIME DEFAULT NULL,
  pre_confirmed_by      INT UNSIGNED DEFAULT NULL,

  -- Post-meeting confirmation (did it actually happen?)
  post_confirmed        TINYINT(1) DEFAULT 0,
  post_confirmed_at     DATETIME DEFAULT NULL,
  post_confirmed_note   TEXT DEFAULT NULL,

  -- Post-meeting outcome
  -- 'pending'       = meeting not happened yet
  -- 'attended'      = happened, no immediate deal
  -- 'no_show'       = client didn't show
  -- 'rescheduled'   = needs rescheduling
  -- 'converted'     = deal closed in this meeting
  -- 'follow_up'     = next meeting needed
  outcome               ENUM('pending','attended','no_show','rescheduled','converted','follow_up') DEFAULT 'pending',

  -- If a follow-up meeting is scheduled, link it here
  followup_meeting_id   INT UNSIGNED DEFAULT NULL,

  -- The lead_follow_up record that was auto-created from this meeting
  linked_follow_up_id   INT UNSIGNED DEFAULT NULL,

  -- Soft delete
  deleted               TINYINT(1) DEFAULT 0,

  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_meeting_date (meeting_date),
  INDEX idx_created_by (created_by),
  INDEX idx_lead_id (lead_id)
);

-- Unique: one slot per day per user (one meeting per morning/afternoon/evening)
-- Commented out to keep flexible — uncomment if you want strict enforcement
-- ALTER TABLE sales_meetings ADD UNIQUE KEY uq_user_date_slot (created_by, meeting_date, slot);
