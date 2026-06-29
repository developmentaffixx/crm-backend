-- ============================================================
-- Monthly Performance Report (MPR) - MySQL Schema
-- ============================================================

USE crm_task_module;

CREATE TABLE IF NOT EXISTS smm_monthly_reports (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id        INT UNSIGNED NOT NULL,
  reporting_month   VARCHAR(20) NOT NULL,
  reporting_period  VARCHAR(100) DEFAULT NULL,
  report_version    VARCHAR(20) DEFAULT '1.0',
  report_date       DATE DEFAULT NULL,

  -- Section 2: Executive Summary
  executive_summary TEXT DEFAULT NULL,
  highlights        JSON DEFAULT NULL,

  -- Section 3: KPI Performance (JSON array: [{kpi, target, achieved, status}])
  kpi_performance   JSON DEFAULT NULL,

  -- Section 4: Social Media Performance (JSON: {reach:{current,previous,growth},...})
  social_performance JSON DEFAULT NULL,

  -- Section 5: Content Performance (JSON: {top:{content,format,objective,result,why_worked},lowest:{...}})
  content_performance JSON DEFAULT NULL,

  -- Section 6: Content Distribution (JSON: {reels:{planned,published},...,consistency:{planned_days,actual_days,completion}})
  content_distribution JSON DEFAULT NULL,

  -- Section 7: Community Management (JSON: {dms_received,dms_responded,...,insights})
  community_management JSON DEFAULT NULL,

  -- Section 8: Lead Generation (JSON: {sources:[{source,leads}],quality:{hot,warm,cold},observations})
  lead_generation   JSON DEFAULT NULL,

  -- Section 9: Advertising Performance (JSON: {reach,impressions,...,best_ad,recommendations})
  ads_performance   JSON DEFAULT NULL,

  -- Section 10: Competitor & Market Insights
  competitor_insights JSON DEFAULT NULL,

  -- Section 11: What Worked
  what_worked       JSON DEFAULT NULL,

  -- Section 12: Challenges Faced
  challenges_faced  JSON DEFAULT NULL,

  -- Section 13: Strategic Recommendations
  recommendations   JSON DEFAULT NULL,

  -- Section 14: Next Month Action Plan (JSON: {actions:[{activity,owner,timeline}],focus_areas:[]})
  next_month_plan   JSON DEFAULT NULL,

  -- Section 15: Client Feedback
  client_feedback   JSON DEFAULT NULL,

  -- Section 16: Renewal & Growth
  renewal_review    JSON DEFAULT NULL,

  -- Section 17: Internal Review
  internal_review   JSON DEFAULT NULL,

  -- Section 18: Report Approval
  report_approval   JSON DEFAULT NULL,

  -- Monthly Performance Summary
  performance_summary JSON DEFAULT NULL,

  -- Meta
  status            ENUM('draft','submitted','approved') DEFAULT 'draft',
  created_by        INT UNSIGNED NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_smr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_smr_created FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_monthly_report (project_id, reporting_month)
) ENGINE=InnoDB;
