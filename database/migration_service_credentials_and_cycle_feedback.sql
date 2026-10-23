-- ============================================================================
-- Migration: Service Credentials Vault + Cycle Feedback (point-wise, two lists)
-- ----------------------------------------------------------------------------
-- 1. service_credentials  — platform-based credential vault, one row per
--    platform, scoped to a project service. Passwords are stored ENCRYPTED
--    (AES-256-GCM) by the application layer — never plaintext.
-- 2. cycle_feedback        — point-wise feedback for a cycle. Each row is a
--    single point. `side` splits the two independent lists:
--      'client' = Client side list, 'team' = Team side list.
--    A point can carry text and/or a voice recording (audio_url).
-- ============================================================================

-- ── 1. Service Credentials Vault ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_credentials (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id          INT UNSIGNED NOT NULL,
  project_service_id  INT UNSIGNED NOT NULL,
  platform            VARCHAR(120) NOT NULL,          -- e.g. Meta, Google Ads, Instagram
  login_id            VARCHAR(255) DEFAULT NULL,       -- username / email / ID
  password_enc        TEXT DEFAULT NULL,               -- AES-256-GCM encrypted (iv:tag:ciphertext)
  url                 VARCHAR(500) DEFAULT NULL,       -- login / dashboard link
  notes               TEXT DEFAULT NULL,
  created_by          INT UNSIGNED DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_svc_cred_project  FOREIGN KEY (project_id)         REFERENCES projects(id)          ON DELETE CASCADE,
  CONSTRAINT fk_svc_cred_service  FOREIGN KEY (project_service_id) REFERENCES project_services(id)  ON DELETE CASCADE,
  CONSTRAINT fk_svc_cred_user     FOREIGN KEY (created_by)         REFERENCES users(id)             ON DELETE SET NULL,
  INDEX idx_svc_cred_service (project_service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Cycle Feedback (point-wise, two independent lists) ────────────────────
CREATE TABLE IF NOT EXISTS cycle_feedback (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id      INT UNSIGNED NOT NULL,
  project_id    INT UNSIGNED NOT NULL,
  side          ENUM('client','team') NOT NULL,        -- which list the point belongs to
  body          TEXT DEFAULT NULL,                      -- the feedback point text
  audio_url     VARCHAR(500) DEFAULT NULL,              -- optional voice recording
  audio_public_id VARCHAR(255) DEFAULT NULL,            -- Cloudinary public_id for cleanup
  status        ENUM('open','resolved') NOT NULL DEFAULT 'open',
  created_by    INT UNSIGNED DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cfb_cycle   FOREIGN KEY (cycle_id)   REFERENCES service_cycles(id) ON DELETE CASCADE,
  CONSTRAINT fk_cfb_project FOREIGN KEY (project_id) REFERENCES projects(id)       ON DELETE CASCADE,
  CONSTRAINT fk_cfb_user    FOREIGN KEY (created_by) REFERENCES users(id)          ON DELETE SET NULL,
  INDEX idx_cfb_cycle_side (cycle_id, side)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Seed the "credentials" submenu toggle for the projects (Accounts) module ─
-- Grant access to all roles that already have projects module view, so existing
-- admins/managers see the Credentials tab by default. Toggle per-role in Settings.
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'projects', 'credentials', 2
FROM role_permissions rp
WHERE rp.module = 'projects' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);
