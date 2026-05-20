-- ============================================================
-- Chat Module - MySQL Schema
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Conversations (direct 1:1 or group chats)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type        ENUM('direct', 'group') NOT NULL DEFAULT 'direct',
  name        VARCHAR(255) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  avatar_url  VARCHAR(500) DEFAULT NULL,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_conv_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Conversation members
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_members (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  role            ENUM('admin', 'member') NOT NULL DEFAULT 'member',
  joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_at    DATETIME DEFAULT NULL,
  UNIQUE KEY uq_conv_member (conversation_id, user_id),
  CONSTRAINT fk_cm_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  sender_id       INT UNSIGNED NOT NULL,
  content         TEXT NOT NULL,
  message_type    ENUM('text', 'image', 'file', 'system') NOT NULL DEFAULT 'text',
  file_url        VARCHAR(500) DEFAULT NULL,
  file_name       VARCHAR(255) DEFAULT NULL,
  reply_to_id     INT UNSIGNED DEFAULT NULL,
  is_edited       TINYINT(1) NOT NULL DEFAULT 0,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_conv   FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id),
  CONSTRAINT fk_msg_reply  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL,
  INDEX idx_msg_conv_created (conversation_id, created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Message read receipts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reads (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  read_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_msg_read (message_id, user_id),
  CONSTRAINT fk_mr_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_mr_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
