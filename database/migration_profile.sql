USE crm_task_module;

-- ─── Additional profile fields for users ─────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS blood_group    VARCHAR(10)  NOT NULL DEFAULT '' AFTER phone;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender         ENUM('male','female','other','') NOT NULL DEFAULT '' AFTER blood_group;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth  DATE DEFAULT NULL AFTER gender;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address        TEXT DEFAULT NULL AFTER date_of_birth;

-- ─── Leaves table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaves (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  leave_type    ENUM('casual','sick','earned','unpaid') NOT NULL DEFAULT 'casual',
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  days          DECIMAL(4,1) NOT NULL DEFAULT 1,
  reason        TEXT NOT NULL,
  status        ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  approved_by   INT UNSIGNED DEFAULT NULL,
  remarks       TEXT DEFAULT NULL,
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_leaves_user     FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_leaves_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ─── Leave balances table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_balances (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  leave_type    ENUM('casual','sick','earned') NOT NULL,
  total         DECIMAL(4,1) NOT NULL DEFAULT 12,
  used          DECIMAL(4,1) NOT NULL DEFAULT 0,
  year          YEAR NOT NULL,
  CONSTRAINT fk_lb_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_user_type_year (user_id, leave_type, year)
) ENGINE=InnoDB;
