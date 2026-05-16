-- ============================================================
-- Task & Approvals Module - MySQL Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS crm_task_module CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE crm_task_module;

-- ------------------------------------------------------------
-- Users table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  email       VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_admin    TINYINT(1) NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Tasks table
-- is_active: 0=pending approval, 1=active, 2=pending closing, 3=done/closed
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_to INT UNSIGNED NOT NULL,
  created_by  INT UNSIGNED NOT NULL,
  start_date  DATE,
  deadline    DATE,
  priority    ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status      ENUM('to_do','in_progress','done') NOT NULL DEFAULT 'to_do',
  is_active   TINYINT(1) NOT NULL DEFAULT 0,
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_assigned FOREIGN KEY (assigned_to) REFERENCES users(id),
  CONSTRAINT fk_tasks_created  FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Task deadline extension requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_deadline_extension_requests (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id            INT UNSIGNED NOT NULL,
  requested_by       INT UNSIGNED NOT NULL,
  requested_deadline DATE NOT NULL,
  reason             TEXT NOT NULL,
  status             ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  deleted            TINYINT(1) NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ext_task    FOREIGN KEY (task_id)      REFERENCES tasks(id),
  CONSTRAINT fk_ext_user    FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Task forward requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_forward_requests (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id      INT UNSIGNED NOT NULL,
  forwarded_by INT UNSIGNED NOT NULL,
  forwarded_to INT UNSIGNED NOT NULL,
  status       ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  deleted      TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fwd_task FOREIGN KEY (task_id)      REFERENCES tasks(id),
  CONSTRAINT fk_fwd_by   FOREIGN KEY (forwarded_by) REFERENCES users(id),
  CONSTRAINT fk_fwd_to   FOREIGN KEY (forwarded_to) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Seed: demo admin + team members (passwords = "password123")
-- bcrypt hash of "password123"
-- ------------------------------------------------------------
-- password for all users: password123
INSERT INTO users (first_name, last_name, email, password_hash, is_admin) VALUES
('Admin',  'User',  'admin@crm.com',  '$2a$10$osoFuMK7sRWWdJthHC4jn.Xj6JFm29Ns0/JhxCVPc2/DkTXbuDW7e', 1),
('Alice',  'Smith', 'alice@crm.com',  '$2a$10$osoFuMK7sRWWdJthHC4jn.Xj6JFm29Ns0/JhxCVPc2/DkTXbuDW7e', 0),
('Bob',    'Jones', 'bob@crm.com',    '$2a$10$osoFuMK7sRWWdJthHC4jn.Xj6JFm29Ns0/JhxCVPc2/DkTXbuDW7e', 0),
('Carol',  'White', 'carol@crm.com',  '$2a$10$osoFuMK7sRWWdJthHC4jn.Xj6JFm29Ns0/JhxCVPc2/DkTXbuDW7e', 0);
