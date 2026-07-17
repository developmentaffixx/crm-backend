USE crm_task_module;

-- ─── AI Labs: Tool Library (master list of all discovered tools) ──────────────
CREATE TABLE IF NOT EXISTS ai_tools (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  url           VARCHAR(500) DEFAULT NULL,
  category      VARCHAR(100) NOT NULL DEFAULT 'general',
  description   TEXT DEFAULT NULL,
  added_by      INT UNSIGNED NOT NULL,
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_tools_user FOREIGN KEY (added_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ─── AI Labs: Daily Tool Testing Logs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tool_tests (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  tool_id       INT UNSIGNED DEFAULT NULL,
  tool_name     VARCHAR(255) NOT NULL,
  tool_url      VARCHAR(500) DEFAULT NULL,
  category      VARCHAR(100) NOT NULL DEFAULT 'general',
  rating        TINYINT UNSIGNED DEFAULT NULL COMMENT '1-5 stars',
  summary       TEXT DEFAULT NULL COMMENT 'Quick review/notes',
  use_case      TEXT DEFAULT NULL COMMENT 'How it could help workflow',
  screenshot_url VARCHAR(500) DEFAULT NULL,
  test_date     DATE NOT NULL DEFAULT (CURRENT_DATE),
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_tests_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ai_tests_tool FOREIGN KEY (tool_id) REFERENCES ai_tools(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ─── AI Labs: Reports (detailed write-ups, needs admin approval) ─────────────
CREATE TABLE IF NOT EXISTS ai_reports (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  title         VARCHAR(255) NOT NULL,
  content       TEXT NOT NULL,
  category      VARCHAR(100) NOT NULL DEFAULT 'ai_tools',
  tool_id       INT UNSIGNED DEFAULT NULL,
  status        ENUM('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft',
  approved_by   INT UNSIGNED DEFAULT NULL,
  approved_at   DATETIME DEFAULT NULL,
  rejection_note TEXT DEFAULT NULL,
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_reports_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ai_reports_tool FOREIGN KEY (tool_id) REFERENCES ai_tools(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_reports_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ─── AI Labs: Points System ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_points (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  points        INT NOT NULL DEFAULT 0,
  action_type   ENUM('tool_test','report_submitted','report_approved','streak_bonus','implementation') NOT NULL,
  reference_id  INT UNSIGNED DEFAULT NULL COMMENT 'ID of related test/report',
  note          VARCHAR(255) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_points_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ─── AI Labs: Streaks Tracking ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_streaks (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  current_streak  INT UNSIGNED NOT NULL DEFAULT 0,
  longest_streak  INT UNSIGNED NOT NULL DEFAULT 0,
  last_test_date  DATE DEFAULT NULL,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_streaks_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_ai_streaks_user (user_id)
) ENGINE=InnoDB;

-- ─── AI Labs: Comments/Discussions on tool tests ─────────────────────────────
CREATE TABLE IF NOT EXISTS ai_comments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  test_id       INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  comment       TEXT NOT NULL,
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_comments_test FOREIGN KEY (test_id) REFERENCES ai_tool_tests(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_comments_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ─── AI Labs: Upvotes on tool tests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_upvotes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  test_id       INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_upvotes_test FOREIGN KEY (test_id) REFERENCES ai_tool_tests(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_upvotes_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_ai_upvote (test_id, user_id)
) ENGINE=InnoDB;
