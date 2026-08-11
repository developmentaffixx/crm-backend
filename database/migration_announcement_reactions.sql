-- Announcement Reactions
CREATE TABLE IF NOT EXISTS announcement_reactions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  announcement_id INT NOT NULL,
  user_id        INT NOT NULL,
  emoji          VARCHAR(10) NOT NULL DEFAULT '👍',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_reaction (announcement_id, user_id),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE
);
