USE crm_task_module;

-- ─── Reimbursements table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reimbursements (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  category        ENUM('travel','food','medical','equipment','accommodation','transport','other') NOT NULL DEFAULT 'other',
  amount          DECIMAL(12,2) NOT NULL,
  expense_date    DATE NOT NULL,
  description     TEXT NOT NULL,
  receipt_url     VARCHAR(500) DEFAULT NULL,
  is_group        TINYINT(1) NOT NULL DEFAULT 0,
  group_members   JSON DEFAULT NULL,
  status          ENUM('pending','approved','rejected','paid') NOT NULL DEFAULT 'pending',
  approved_by     INT UNSIGNED DEFAULT NULL,
  remarks         TEXT DEFAULT NULL,
  paid_at         DATETIME DEFAULT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reimb_user     FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_reimb_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
