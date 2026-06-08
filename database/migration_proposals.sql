-- ─────────────────────────────────────────────────────────────────────────────
-- Proposals (Web-based client proposal pages)
-- Drop old table if exists and recreate with new structure
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS proposals;

CREATE TABLE proposals (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  proposal_token   VARCHAR(64)  NOT NULL UNIQUE,
  lead_id          INT          DEFAULT NULL,
  client_id        INT          DEFAULT NULL,

  -- Cover / Basics
  title            VARCHAR(255) NOT NULL,
  tagline          VARCHAR(500) DEFAULT NULL,
  client_name      VARCHAR(255) NOT NULL,
  client_company   VARCHAR(255) DEFAULT NULL,
  brand_color      VARCHAR(10)  DEFAULT '#3b2314',

  -- Section: Project Overview
  project_overview TEXT         DEFAULT NULL,

  -- Section: Problem / Research
  pain_points      JSON         DEFAULT NULL,
  gaps             JSON         DEFAULT NULL,
  opportunities    JSON         DEFAULT NULL,

  -- Section: 90-Day Goals  { "1": [...], "2": [...], "3": [...] }
  goals            JSON         DEFAULT NULL,

  -- Section: Services + Plans comparison table (array of service objects)
  services_plans   JSON         DEFAULT NULL,

  -- Section: Ad Investment
  ad_investment    JSON         DEFAULT NULL,

  -- Section: Investment Summary
  investment_summary JSON       DEFAULT NULL,

  -- Section: Why Choose Us (array of { title, description })
  why_us           JSON         DEFAULT NULL,

  -- Section: Custom sections (array of { title, type, content, items })
  custom_sections  JSON         DEFAULT NULL,

  -- Validity
  validity_days    INT          DEFAULT 7,
  expires_at       DATETIME     DEFAULT NULL,

  -- Status: draft → sent → viewed → accepted / rejected
  status           ENUM('draft','sent','viewed','accepted','rejected') DEFAULT 'draft',

  -- View tracking
  view_count       INT          DEFAULT 0,
  first_viewed_at  DATETIME     DEFAULT NULL,
  last_viewed_at   DATETIME     DEFAULT NULL,

  -- Client response
  client_note      TEXT         DEFAULT NULL,
  responded_at     DATETIME     DEFAULT NULL,

  -- Footer / contact info
  prepared_by_name    VARCHAR(255) DEFAULT NULL,
  prepared_by_email   VARCHAR(255) DEFAULT NULL,
  prepared_by_phone   VARCHAR(50)  DEFAULT NULL,
  prepared_by_website VARCHAR(255) DEFAULT NULL,

  -- Meta
  created_by  INT          NOT NULL,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted     TINYINT(1)   DEFAULT 0,

  INDEX idx_proposals_token   (proposal_token),
  INDEX idx_proposals_lead    (lead_id),
  INDEX idx_proposals_status  (status),
  INDEX idx_proposals_created (created_by)
);
