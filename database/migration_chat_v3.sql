-- ============================================================
-- Chat Module V3 - Polls, Delete for me, Group member management
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Polls
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_polls (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id      INT UNSIGNED NOT NULL,
  conversation_id INT UNSIGNED NOT NULL,
  question        VARCHAR(500) NOT NULL,
  allow_multiple  TINYINT(1) NOT NULL DEFAULT 0,
  created_by      INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_poll_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_poll_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_poll_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_poll_options (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  poll_id INT UNSIGNED NOT NULL,
  text    VARCHAR(255) NOT NULL,
  CONSTRAINT fk_opt_poll FOREIGN KEY (poll_id) REFERENCES chat_polls(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_poll_votes (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  poll_id   INT UNSIGNED NOT NULL,
  option_id INT UNSIGNED NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  voted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_poll_vote (poll_id, option_id, user_id),
  CONSTRAINT fk_vote_poll FOREIGN KEY (poll_id) REFERENCES chat_polls(id) ON DELETE CASCADE,
  CONSTRAINT fk_vote_opt  FOREIGN KEY (option_id) REFERENCES chat_poll_options(id) ON DELETE CASCADE,
  CONSTRAINT fk_vote_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Delete for me (per-user message deletion tracking)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_deletions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_msg_del (message_id, user_id),
  CONSTRAINT fk_mdel_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_mdel_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Add 'poll' to message_type enum
-- ------------------------------------------------------------
ALTER TABLE messages MODIFY COLUMN message_type ENUM('text', 'image', 'file', 'system', 'poll') NOT NULL DEFAULT 'text';
