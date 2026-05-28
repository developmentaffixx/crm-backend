USE u627061298_database_crm;

-- ============================================================
-- Interview Scheduler Module - Database Migration
-- Only 2 tables: interview_candidates + interview_rounds
-- Siblings & referrals stored as JSON in candidate table
-- ============================================================

-- ------------------------------------------------------------
-- Interview Candidates
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_candidates (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name             VARCHAR(150) NOT NULL,
  email                 VARCHAR(150) DEFAULT NULL,
  contact_number        VARCHAR(20) DEFAULT NULL,
  date_of_birth         DATE DEFAULT NULL,
  gender                ENUM('male','female','other') DEFAULT NULL,
  address               TEXT DEFAULT NULL,
  nationality           VARCHAR(80) DEFAULT NULL,
  marital_status        ENUM('single','married','other') DEFAULT NULL,
  husband_name          VARCHAR(150) DEFAULT NULL,
  husband_occupation    VARCHAR(150) DEFAULT NULL,
  father_name           VARCHAR(150) DEFAULT NULL,
  father_occupation     VARCHAR(150) DEFAULT NULL,
  mother_name           VARCHAR(150) DEFAULT NULL,
  mother_occupation     VARCHAR(150) DEFAULT NULL,
  siblings              JSON DEFAULT NULL,
  mode_of_transport     VARCHAR(80) DEFAULT NULL,
  position_applied      VARCHAR(120) NOT NULL,
  expected_salary       DECIMAL(12,2) DEFAULT NULL,
  last_salary           DECIMAL(12,2) DEFAULT NULL,
  immediate_joining     ENUM('yes','no') DEFAULT NULL,
  available_start_date  DATE DEFAULT NULL,
  highest_qualification VARCHAR(150) DEFAULT NULL,
  university            VARCHAR(200) DEFAULT NULL,
  year_of_passing       YEAR DEFAULT NULL,
  additional_certs      TEXT DEFAULT NULL,
  resume_path           VARCHAR(255) DEFAULT NULL,
  experience_level      ENUM('fresher','experienced') DEFAULT NULL,
  total_experience_years DECIMAL(4,1) DEFAULT NULL,
  previous_company      VARCHAR(150) DEFAULT NULL,
  last_designation      VARCHAR(150) DEFAULT NULL,
  employment_from       DATE DEFAULT NULL,
  employment_to         DATE DEFAULT NULL,
  reason_for_leaving    TEXT DEFAULT NULL,
  comfortable_relocating TINYINT(1) DEFAULT 0,
  has_medical_condition  TINYINT(1) DEFAULT 0,
  medical_condition_note TEXT DEFAULT NULL,
  referrals             JSON DEFAULT NULL,
  source                ENUM('joinus_form','indeed','linkedin','referral','walk_in','other') NOT NULL DEFAULT 'joinus_form',
  status                ENUM('new','shortlisted','in_process','selected','rejected','on_hold') NOT NULL DEFAULT 'new',
  shortlisted_by        INT UNSIGNED DEFAULT NULL,
  shortlisted_at        DATETIME DEFAULT NULL,
  deleted               TINYINT(1) NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ic_shortlisted_by FOREIGN KEY (shortlisted_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ic_status (status),
  INDEX idx_ic_email (email),
  INDEX idx_ic_created (created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Interview Rounds (screening rounds per candidate)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_rounds (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  candidate_id    INT UNSIGNED NOT NULL,
  round_number    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  round_name      VARCHAR(100) NOT NULL DEFAULT 'Round 1',
  interviewer_id  INT UNSIGNED DEFAULT NULL,
  scheduled_date  DATE DEFAULT NULL,
  scheduled_time  TIME DEFAULT NULL,
  mode            ENUM('in_person','phone','video') DEFAULT 'in_person',
  status          ENUM('scheduled','completed','cancelled','rescheduled') NOT NULL DEFAULT 'scheduled',
  verdict         ENUM('selected','rejected','on_hold') DEFAULT NULL,
  rating          TINYINT UNSIGNED DEFAULT NULL,
  remarks         TEXT DEFAULT NULL,
  completed_at    DATETIME DEFAULT NULL,
  created_by      INT UNSIGNED DEFAULT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ir_candidate   FOREIGN KEY (candidate_id)   REFERENCES interview_candidates(id) ON DELETE CASCADE,
  CONSTRAINT fk_ir_interviewer FOREIGN KEY (interviewer_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ir_created_by  FOREIGN KEY (created_by)     REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ir_candidate (candidate_id),
  INDEX idx_ir_scheduled (scheduled_date)
) ENGINE=InnoDB;
