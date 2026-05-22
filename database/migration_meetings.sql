USE crm_task_module;

-- ============================================================
-- Meetings Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Meetings table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title             VARCHAR(255) NOT NULL,
  description       TEXT DEFAULT NULL,
  meeting_type      ENUM('client','office') NOT NULL DEFAULT 'office',
  client_id         INT UNSIGNED DEFAULT NULL,
  meeting_date      DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  location_type     ENUM('office','client_place','virtual') NOT NULL DEFAULT 'office',
  meeting_link      VARCHAR(500) DEFAULT NULL,
  status            ENUM('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  mom               TEXT DEFAULT NULL,
  created_by        INT UNSIGNED NOT NULL,
  deleted           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_meetings_client  FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_meetings_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Meeting members (multiple members per meeting)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_members (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id  INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  CONSTRAINT fk_mm_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_mm_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_meeting_member (meeting_id, user_id)
) ENGINE=InnoDB;
