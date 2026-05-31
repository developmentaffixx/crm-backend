USE crm_task_module;

-- ============================================================
-- Monthly Performance Evaluation Module
-- ============================================================

-- ------------------------------------------------------------
-- Monthly Evaluations — auto-calculated monthly KPI summary
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_evaluations (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  eval_month      DATE NOT NULL,           -- first day of the month (e.g. 2025-06-01)
  
  -- Auto-calculated KPIs (aggregated from daily_reports for the month)
  total_leads_sourced       INT DEFAULT 0,
  total_outreach_sent       INT DEFAULT 0,
  total_follow_ups_done     INT DEFAULT 0,
  total_calls_completed     INT DEFAULT 0,
  total_replies_received    INT DEFAULT 0,
  total_interested_leads    INT DEFAULT 0,
  total_meetings_booked     INT DEFAULT 0,
  total_proposals_sent      INT DEFAULT 0,
  total_closures_assisted   INT DEFAULT 0,
  revenue_contribution      DECIMAL(12,2) DEFAULT 0,
  days_reported             INT DEFAULT 0,
  working_days              INT DEFAULT 0,
  
  -- Auto-calculated metrics
  outreach_consistency      DECIMAL(5,2) DEFAULT 0,   -- days_reported / working_days * 100
  reply_rate                DECIMAL(5,2) DEFAULT 0,   -- replies / outreach * 100
  meeting_conversion_rate   DECIMAL(5,2) DEFAULT 0,   -- meetings / replies * 100
  pipeline_contribution     DECIMAL(5,2) DEFAULT 0,   -- lead contribution score
  crm_discipline_score      DECIMAL(5,2) DEFAULT 0,   -- update consistency %
  
  -- Overall performance
  overall_score             DECIMAL(5,2) DEFAULT 0,   -- 0-100
  performance_status        VARCHAR(30) DEFAULT 'needs_improvement',
  -- Statuses: excellent (90-100), very_good (75-89), good (60-74), needs_improvement (40-59), critical (<40)
  
  generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_me_user (user_id),
  INDEX idx_me_month (eval_month),
  UNIQUE KEY unique_user_month (user_id, eval_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Monthly Manager Evaluations — manual ratings by manager
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_manager_evaluations (
  id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
  monthly_evaluation_id       BIGINT NOT NULL,
  reviewer_id                 BIGINT NOT NULL,
  
  -- Ratings (1-10)
  communication_skill         TINYINT DEFAULT NULL,
  consistency                 TINYINT DEFAULT NULL,
  team_contribution           TINYINT DEFAULT NULL,
  discipline                  TINYINT DEFAULT NULL,
  lead_quality                TINYINT DEFAULT NULL,
  improvement_since_last      TINYINT DEFAULT NULL,
  leadership_potential        TINYINT DEFAULT NULL,
  client_interaction_quality  TINYINT DEFAULT NULL,
  
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_mme_eval FOREIGN KEY (monthly_evaluation_id) REFERENCES monthly_evaluations(id) ON DELETE CASCADE,
  UNIQUE KEY unique_eval_reviewer (monthly_evaluation_id, reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Monthly Decisions — incentive/bonus/warning/promotion flags
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_decisions (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  monthly_evaluation_id   BIGINT NOT NULL,
  decided_by              BIGINT NOT NULL,
  
  incentive_eligible      TINYINT(1) DEFAULT 0,
  bonus_eligible          TINYINT(1) DEFAULT 0,
  warning_required        TINYINT(1) DEFAULT 0,
  promotion_ready         TINYINT(1) DEFAULT 0,
  training_required       TINYINT(1) DEFAULT 0,
  
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_md_eval FOREIGN KEY (monthly_evaluation_id) REFERENCES monthly_evaluations(id) ON DELETE CASCADE,
  UNIQUE KEY unique_eval_decision (monthly_evaluation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Monthly Feedback — text feedback section
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_feedback (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  monthly_evaluation_id   BIGINT NOT NULL,
  feedback_by             BIGINT NOT NULL,
  
  major_strengths         TEXT DEFAULT NULL,
  major_weakness          TEXT DEFAULT NULL,
  areas_to_improve        TEXT DEFAULT NULL,
  next_month_focus        TEXT DEFAULT NULL,
  
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_mf_eval FOREIGN KEY (monthly_evaluation_id) REFERENCES monthly_evaluations(id) ON DELETE CASCADE,
  UNIQUE KEY unique_eval_feedback (monthly_evaluation_id, feedback_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
