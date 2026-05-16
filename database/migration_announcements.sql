USE crm_task_module;

-- ─── Announcements table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  content       TEXT NOT NULL,
  priority      ENUM('normal','important','urgent') NOT NULL DEFAULT 'normal',
  is_pinned     TINYINT(1) NOT NULL DEFAULT 0,
  created_by    INT UNSIGNED NOT NULL,
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_announce_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ─── Track read status per user ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcement_reads (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  announcement_id INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ar_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_announce_user (announcement_id, user_id)
) ENGINE=InnoDB;
