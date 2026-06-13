-- ─────────────────────────────────────────────────────────────────────────────
-- PROPOSAL ENGINE — Full Database Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Service Templates (section definitions per service type)
CREATE TABLE IF NOT EXISTS proposal_service_templates (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  service_key   VARCHAR(50) NOT NULL UNIQUE,   -- smm, personal_branding, website_dev, seo, performance_marketing
  service_name  VARCHAR(100) NOT NULL,
  sections      JSON NOT NULL,                 -- array of section objects: [{key, title, type, content}]
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Industry Blocks (industry-specific content that modifies template sections)
CREATE TABLE IF NOT EXISTS proposal_industry_blocks (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  industry_key   VARCHAR(50) NOT NULL,          -- education, real_estate, restaurant, fashion, other
  industry_name  VARCHAR(100) NOT NULL,
  service_key    VARCHAR(50) NOT NULL,          -- links to which service this applies to
  executive_summary TEXT DEFAULT NULL,
  challenges     JSON DEFAULT NULL,             -- array of strings
  opportunities  JSON DEFAULT NULL,             -- array of strings
  expected_outcomes JSON DEFAULT NULL,          -- array of strings
  case_study_ids JSON DEFAULT NULL,             -- array of case_study IDs relevant to this combo
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_industry_service (industry_key, service_key)
);

-- 3. Persona Blocks (for Personal Branding service)
CREATE TABLE IF NOT EXISTS proposal_persona_blocks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  persona_key   VARCHAR(50) NOT NULL UNIQUE,    -- doctor, lawyer, entrepreneur, business_owner, consultant, coach, other
  persona_name  VARCHAR(100) NOT NULL,
  positioning   TEXT DEFAULT NULL,
  audience      TEXT DEFAULT NULL,
  content_strategy TEXT DEFAULT NULL,
  expected_outcomes JSON DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4. Case Study Library
CREATE TABLE IF NOT EXISTS proposal_case_studies (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  client_name   VARCHAR(255) NOT NULL,
  industry_key  VARCHAR(50) DEFAULT NULL,
  service_key   VARCHAR(50) DEFAULT NULL,
  situation     TEXT DEFAULT NULL,
  what_we_did   TEXT DEFAULT NULL,
  results       TEXT DEFAULT NULL,
  metrics       JSON DEFAULT NULL,              -- [{label, value}]
  image_url     VARCHAR(500) DEFAULT NULL,
  is_active     TINYINT(1) DEFAULT 1,
  created_by    INT DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 5. Generated Proposals
CREATE TABLE IF NOT EXISTS proposals (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  proposal_token  VARCHAR(64) NOT NULL UNIQUE,

  -- Step 1: Client
  lead_id         INT DEFAULT NULL,
  client_id       INT DEFAULT NULL,

  -- Step 2: Service
  service_key     VARCHAR(50) NOT NULL,

  -- Step 3: Industry
  industry_key    VARCHAR(50) NOT NULL,

  -- Step 3b: Persona (only for personal_branding)
  persona_key     VARCHAR(50) DEFAULT NULL,

  -- Step 4: Client Info
  client_name     VARCHAR(255) NOT NULL,
  business_name   VARCHAR(255) DEFAULT NULL,
  contact_person  VARCHAR(255) DEFAULT NULL,
  designation     VARCHAR(255) DEFAULT NULL,
  phone           VARCHAR(50) DEFAULT NULL,
  email           VARCHAR(255) DEFAULT NULL,
  website         VARCHAR(500) DEFAULT NULL,
  social_links    JSON DEFAULT NULL,

  -- Step 5: Opportunity Info
  current_situation TEXT DEFAULT NULL,
  pain_points     JSON DEFAULT NULL,
  opportunities   JSON DEFAULT NULL,
  goals           TEXT DEFAULT NULL,
  special_notes   TEXT DEFAULT NULL,

  -- Step 5b: Website Dev specific
  website_type    ENUM('new', 'revamp') DEFAULT NULL,
  existing_issues TEXT DEFAULT NULL,
  recommended_improvements TEXT DEFAULT NULL,

  -- Step 6: Pricing
  pricing_package ENUM('starter', 'growth', 'premium', 'custom') DEFAULT 'custom',
  service_cost    DECIMAL(12,2) DEFAULT 0,
  ad_spend        DECIMAL(12,2) DEFAULT 0,
  additional_cost DECIMAL(12,2) DEFAULT 0,
  one_time_cost   DECIMAL(12,2) DEFAULT 0,
  monthly_cost    DECIMAL(12,2) DEFAULT 0,
  total_monthly   DECIMAL(12,2) DEFAULT 0,
  total_first_month DECIMAL(12,2) DEFAULT 0,
  pricing_notes   TEXT DEFAULT NULL,

  -- Selected case studies
  case_study_ids  JSON DEFAULT NULL,

  -- Selected plan from proposal_plans (service_id from proposal_services)
  selected_plan_service_id INT DEFAULT NULL,

  -- Generated content (assembled from template + industry + inputs)
  generated_content JSON DEFAULT NULL,

  -- Validity & Status
  validity_days   INT DEFAULT 7,
  expires_at      DATETIME DEFAULT NULL,
  status          ENUM('draft','sent','viewed','accepted','rejected') DEFAULT 'draft',

  -- View tracking
  view_count      INT DEFAULT 0,
  first_viewed_at DATETIME DEFAULT NULL,
  last_viewed_at  DATETIME DEFAULT NULL,

  -- Client response
  client_note     TEXT DEFAULT NULL,
  responded_at    DATETIME DEFAULT NULL,

  -- Prepared by
  prepared_by_name    VARCHAR(255) DEFAULT NULL,
  prepared_by_email   VARCHAR(255) DEFAULT NULL,
  prepared_by_phone   VARCHAR(50) DEFAULT NULL,
  prepared_by_website VARCHAR(255) DEFAULT NULL,

  -- Meta
  created_by      INT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted         TINYINT(1) DEFAULT 0,

  INDEX idx_pe_token (proposal_token),
  INDEX idx_pe_status (status),
  INDEX idx_pe_created_by (created_by),
  INDEX idx_pe_service (service_key),
  INDEX idx_pe_industry (industry_key)
);
