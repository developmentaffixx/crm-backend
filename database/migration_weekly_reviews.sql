USE crm_task_module;

-- ============================================================
-- Weekly Performance Review Module
-- ============================================================

-- ------------------------------------------------------------
-- Weekly Reviews — auto-calculated KPI summary per user per week
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  week_start      DATE NOT NULL,
  week_end        DATE NOT NULL,
  
  -- Auto-calculated KPIs (from daily_reports)
  total_leads_sourced       INT DEFAULT 0,
  total_outreach_sent       INT DEFAULT 0,
  total_follow_ups_done     INT DEFAULT 0,
  total_calls_completed     INT DEFAULT 0,
  total_replies_received    INT DEFAULT 0,
  total_interested_leads    INT DEFAULT 0,
  total_meetings_booked     INT DEFAULT 0,
  days_reported             INT DEFAULT 0,
  days_crm_updated          INT DEFAULT 0,
  
  -- Auto-calculated metrics
  reply_rate                DECIMAL(5,2) DEFAULT 0,        -- replies / outreach * 100
  meeting_booking_rate      DECIMAL(5,2) DEFAULT 0,        -- meetings / replies * 100
  follow_up_consistency     DECIMAL(5,2) DEFAULT 0,        -- follow_ups / working_days
  lead_activity_score       DECIMAL(5,2) DEFAULT 0,        -- combined KPI score
  crm_discipline_score      DECIMAL(5,2) DEFAULT 0,        -- based on report completion %
  
  -- Overall performance
  overall_score             DECIMAL(5,2) DEFAULT 0,        -- 0-100
  performance_status        ENUM('green','yellow','red') DEFAULT 'red',
  
  -- Timestamps
  generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_wr_user (user_id),
  INDEX idx_wr_week (week_start, week_end),
  UNIQUE KEY unique_user_week (user_id, week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Weekly Manager Reviews — manual input by manager
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_manager_reviews (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  weekly_review_id        BIGINT NOT NULL,
  reviewer_id             BIGINT NOT NULL,
  
  -- Ratings (1-10)
  communication_quality   TINYINT DEFAULT NULL,
  lead_quality            TINYINT DEFAULT NULL,
  follow_up_discipline    TINYINT DEFAULT NULL,
  crm_discipline          TINYINT DEFAULT NULL,
  
  -- Text feedback
  strengths_observed      TEXT DEFAULT NULL,
  weakness_observed       TEXT DEFAULT NULL,
  improvements_required   TEXT DEFAULT NULL,
  training_recommended    TINYINT(1) DEFAULT 0,
  
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_wmr_review FOREIGN KEY (weekly_review_id) REFERENCES weekly_reviews(id) ON DELETE CASCADE,
  UNIQUE KEY unique_review_reviewer (weekly_review_id, reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Weekly Self Reviews — employee self-assessment
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_self_reviews (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  weekly_review_id        BIGINT NOT NULL,
  user_id                 BIGINT NOT NULL,
  
  biggest_challenge       TEXT DEFAULT NULL,
  best_achievement        TEXT DEFAULT NULL,
  skills_need_improvement TEXT DEFAULT NULL,
  next_week_focus         TEXT DEFAULT NULL,
  
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_wsr_review FOREIGN KEY (weekly_review_id) REFERENCES weekly_reviews(id) ON DELETE CASCADE,
  UNIQUE KEY unique_review_user (weekly_review_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
