-- Client Portal Users table
-- Stores login credentials for client dashboard access
CREATE TABLE IF NOT EXISTS client_portal_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL COMMENT 'References leads.id (won leads = clients)',
  login_email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  plain_password VARCHAR(255) DEFAULT NULL COMMENT 'Stored temporarily for display in CRM',
  is_active TINYINT(1) DEFAULT 1,
  last_login_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_login_email (login_email),
  UNIQUE KEY uk_client_id (client_id),
  INDEX idx_client_id (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Activity Feed (for "Today at AffixxMedia" feed)
CREATE TABLE IF NOT EXISTS client_portal_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  activity_type VARCHAR(100) NOT NULL COMMENT 'e.g. reel_edited, campaign_optimized, seo_audit, report_uploaded, design_approval',
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT NULL,
  icon VARCHAR(50) DEFAULT NULL,
  created_by INT DEFAULT NULL COMMENT 'CRM user who created this',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_activities (client_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Progress Bars
CREATE TABLE IF NOT EXISTS client_portal_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  label VARCHAR(255) NOT NULL COMMENT 'e.g. SEO Progress, Content Production',
  percentage INT DEFAULT 0,
  color VARCHAR(20) DEFAULT '#6366f1',
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client_progress (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Monthly Wins
CREATE TABLE IF NOT EXISTS client_portal_wins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(255) NOT NULL COMMENT 'e.g. Reach increased 42%',
  icon VARCHAR(50) DEFAULT '🏆',
  month VARCHAR(20) DEFAULT NULL COMMENT 'e.g. 2025-06',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_wins (client_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Next Actions
CREATE TABLE IF NOT EXISTS client_portal_next_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  action_type ENUM('approval', 'deliverable', 'meeting', 'info') DEFAULT 'info',
  due_date DATE DEFAULT NULL,
  is_completed TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client_actions (client_id, is_completed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Team Members (who's working for this client)
CREATE TABLE IF NOT EXISTS client_portal_team (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  user_id INT DEFAULT NULL COMMENT 'CRM user ID',
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL COMMENT 'e.g. Account Manager, Designer, Strategist',
  avatar_url VARCHAR(500) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  INDEX idx_client_team (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Brand Health Score
CREATE TABLE IF NOT EXISTS client_portal_brand_health (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  score INT DEFAULT 0 COMMENT 'Out of 100',
  posting_consistency INT DEFAULT 0,
  engagement INT DEFAULT 0,
  seo_health INT DEFAULT 0,
  ad_consistency INT DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_client_brand_health (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Approvals
CREATE TABLE IF NOT EXISTS client_portal_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT NULL,
  file_url VARCHAR(500) DEFAULT NULL,
  file_name VARCHAR(255) DEFAULT NULL,
  status ENUM('pending', 'approved', 'needs_changes', 'scheduled') DEFAULT 'pending',
  client_comment TEXT DEFAULT NULL,
  category VARCHAR(100) DEFAULT NULL COMMENT 'e.g. social_media, ads, seo, design',
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client_approvals (client_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Reports
CREATE TABLE IF NOT EXISTS client_portal_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  report_type VARCHAR(100) DEFAULT NULL COMMENT 'e.g. monthly, weekly, campaign',
  file_url VARCHAR(500) DEFAULT NULL,
  file_name VARCHAR(255) DEFAULT NULL,
  month VARCHAR(20) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_reports (client_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Support Requests
CREATE TABLE IF NOT EXISTS client_portal_support (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  subject VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  request_type ENUM('edit', 'question', 'meeting', 'urgent') DEFAULT 'question',
  status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
  reply TEXT DEFAULT NULL,
  replied_by INT DEFAULT NULL,
  replied_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client_support (client_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Pending From Client
CREATE TABLE IF NOT EXISTS client_portal_pending (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT NULL,
  priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
  is_resolved TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  INDEX idx_client_pending (client_id, is_resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Ideas (Ideas We're Exploring)
CREATE TABLE IF NOT EXISTS client_portal_ideas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT NULL,
  status ENUM('exploring', 'recommended', 'approved', 'implementing') DEFAULT 'exploring',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_ideas (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Roadmap
CREATE TABLE IF NOT EXISTS client_portal_roadmap (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  month_number INT NOT NULL COMMENT '1, 2, 3, 4...',
  title VARCHAR(255) NOT NULL COMMENT 'e.g. Setup, Testing, Optimization, Scaling',
  description TEXT DEFAULT NULL,
  is_current TINYINT(1) DEFAULT 0,
  is_completed TINYINT(1) DEFAULT 0,
  INDEX idx_client_roadmap (client_id, month_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Notifications
CREATE TABLE IF NOT EXISTS client_portal_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  type VARCHAR(50) DEFAULT 'info' COMMENT 'info, approval, report, meeting, campaign',
  is_read TINYINT(1) DEFAULT 0,
  link VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_notifications (client_id, is_read, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Portal Meetings
CREATE TABLE IF NOT EXISTS client_portal_meetings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  meeting_type ENUM('onboarding', 'monthly_review', 'quarterly_growth', 'ad_hoc') DEFAULT 'ad_hoc',
  scheduled_at DATETIME NOT NULL,
  duration_minutes INT DEFAULT 30,
  meeting_link VARCHAR(500) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  recording_url VARCHAR(500) DEFAULT NULL,
  status ENUM('scheduled', 'completed', 'cancelled') DEFAULT 'scheduled',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_meetings (client_id, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
