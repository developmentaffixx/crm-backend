-- ============================================================
-- Client Portal V2 - Additional Features Migration
-- ============================================================

-- Service Modules (tracks service-specific data for client view)
CREATE TABLE IF NOT EXISTS client_portal_service_updates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  service_type ENUM('social_media','performance_marketing','seo','personal_branding','website_development') NOT NULL,
  section VARCHAR(100) NOT NULL COMMENT 'e.g. monthly_strategy, content_calendar, keyword_rankings',
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT NULL,
  value VARCHAR(255) DEFAULT NULL,
  file_url VARCHAR(500) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_service_updates (client_id, service_type, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Knowledge Hub (educational content)
CREATE TABLE IF NOT EXISTS client_portal_knowledge (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  category VARCHAR(100) DEFAULT NULL COMMENT 'seo, ads, algorithm, marketing',
  content_type ENUM('article','video','infographic','guide') DEFAULT 'article',
  content_url VARCHAR(500) DEFAULT NULL,
  content_html TEXT DEFAULT NULL,
  thumbnail_url VARCHAR(500) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_knowledge (category, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Weekly Updates
CREATE TABLE IF NOT EXISTS client_portal_weekly_updates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  completed_tasks TEXT DEFAULT NULL COMMENT 'JSON array of tasks',
  current_progress TEXT DEFAULT NULL COMMENT 'JSON array',
  next_steps TEXT DEFAULT NULL COMMENT 'JSON array',
  blockers TEXT DEFAULT NULL COMMENT 'JSON array',
  summary TEXT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_weekly (client_id, week_start DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Upselling Opportunities (locked services)
CREATE TABLE IF NOT EXISTS client_portal_upsell (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  service_name VARCHAR(255) NOT NULL,
  tagline VARCHAR(500) DEFAULT NULL COMMENT 'e.g. SEO Opportunity Available',
  description TEXT DEFAULT NULL,
  icon VARCHAR(50) DEFAULT '🔒',
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upsell (client_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Milestones & Celebrations
CREATE TABLE IF NOT EXISTS client_portal_milestones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(255) NOT NULL COMMENT 'e.g. First 100 Leads!, 1M Impressions',
  description TEXT DEFAULT NULL,
  icon VARCHAR(50) DEFAULT '🎉',
  milestone_date DATE DEFAULT NULL,
  is_celebrated TINYINT(1) DEFAULT 0 COMMENT 'Client has seen the celebration',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_milestones (client_id, is_celebrated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Client Important Dates (birthdays, anniversaries)
CREATE TABLE IF NOT EXISTS client_portal_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  date_type ENUM('birthday','business_anniversary','launch_date','custom') NOT NULL,
  label VARCHAR(255) NOT NULL,
  event_date DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dates (client_id, event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Behind the Scenes Work
CREATE TABLE IF NOT EXISTS client_portal_bts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT DEFAULT NULL,
  category VARCHAR(100) DEFAULT NULL COMMENT 'brainstorming, scripting, research, analytics',
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bts (client_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
