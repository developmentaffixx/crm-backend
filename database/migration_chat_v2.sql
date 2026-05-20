-- ============================================================
-- Chat Module V2 - New features: reactions, search, mentions, forward, edit
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Message Reactions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reactions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  emoji      VARCHAR(10) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_msg_reaction (message_id, user_id, emoji),
  CONSTRAINT fk_react_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_react_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Add forwarded_from_id to messages table
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN forwarded_from_id INT UNSIGNED DEFAULT NULL AFTER reply_to_id;
ALTER TABLE messages ADD CONSTRAINT fk_msg_forward FOREIGN KEY (forwarded_from_id) REFERENCES messages(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Add file_size to messages table
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN file_size INT UNSIGNED DEFAULT NULL AFTER file_name;

-- ------------------------------------------------------------
-- Full-text index for message search
-- ------------------------------------------------------------
ALTER TABLE messages ADD FULLTEXT INDEX ft_msg_content (content);
