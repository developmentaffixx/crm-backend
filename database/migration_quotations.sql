-- Quotations module
CREATE TABLE IF NOT EXISTS quotations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  quotation_number VARCHAR(50) NOT NULL,
  lead_id         INT NULL,
  client_name     VARCHAR(255) NOT NULL,
  client_email    VARCHAR(255) NULL,
  client_phone    VARCHAR(50) NULL,
  service_title   VARCHAR(255) NOT NULL DEFAULT 'Social Media Marketing',
  tagline         VARCHAR(500) NULL,
  description     TEXT NULL,

  -- Process section (JSON arrays)
  process_sections JSON NULL,
  -- e.g. [{ "title": "PLAN", "subtitle": "Build the right strategy...", "items": ["Business & Brand Understanding", ...] }]

  -- Plan Includes
  plan_title      VARCHAR(255) NULL DEFAULT 'Monthly Growth Plan',
  plan_includes   JSON NULL,
  -- e.g. [{ "label": "Platforms Managed", "value": "Instagram & Facebook" }, { "label": "", "value": "8 Reels" }]

  -- Pricing
  investment_amount DECIMAL(12,2) NULL DEFAULT 0,
  investment_label  VARCHAR(100) NULL DEFAULT '/ Month',

  -- Terms & Conditions (JSON array of strings)
  terms           JSON NULL,

  -- Bank Details
  bank_name       VARCHAR(255) NULL,
  account_number  VARCHAR(100) NULL,
  ifsc_code       VARCHAR(50) NULL,
  branch          VARCHAR(255) NULL,
  upi_id          VARCHAR(255) NULL,

  -- Status & Meta
  status          ENUM('Draft','Sent','Accepted','Rejected') DEFAULT 'Draft',
  created_by      INT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted         TINYINT(1) DEFAULT 0,

  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
