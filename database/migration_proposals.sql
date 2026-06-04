-- ─────────────────────────────────────────────────────────────────────────────
-- Proposals (Web-based client proposal pages)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proposals (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  proposal_token   VARCHAR(64)  NOT NULL UNIQUE,          -- public shareable token
  lead_id          INT          DEFAULT NULL,              -- optional link to a lead

  -- Cover / Branding
  title            VARCHAR(255) NOT NULL,
  tagline          VARCHAR(500) DEFAULT NULL,
  client_name      VARCHAR(255) NOT NULL,
  client_company   VARCHAR(255) DEFAULT NULL,
  logo_url         VARCHAR(500) DEFAULT NULL,              -- your company logo
  cover_image_url  VARCHAR(500) DEFAULT NULL,              -- hero background image
  brand_color      VARCHAR(10)  DEFAULT '#000000',         -- hex accent color

  -- Content sections (ordered array stored as JSON)
  -- Each section: { id, type, title, content, order }
  sections         JSON         DEFAULT NULL,

  -- Validity
  validity_days    INT          DEFAULT 7,
  expires_at       DATETIME     DEFAULT NULL,

  -- Status flow: draft → sent → viewed → accepted / rejected
  status           ENUM('draft','sent','viewed','accepted','rejected') DEFAULT 'draft',

  -- View tracking
  view_count       INT          DEFAULT 0,
  first_viewed_at  DATETIME     DEFAULT NULL,
  last_viewed_at   DATETIME     DEFAULT NULL,

  -- Client response
  client_note      TEXT         DEFAULT NULL,              -- message when accepting/rejecting
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
