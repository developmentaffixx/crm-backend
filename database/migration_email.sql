USE crm_task_module;

-- ─── Email SMTP configuration (single row) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS email_settings (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  smtp_host     VARCHAR(255) NOT NULL DEFAULT '',
  smtp_port     INT NOT NULL DEFAULT 587,
  smtp_user     VARCHAR(255) NOT NULL DEFAULT '',
  smtp_pass     VARCHAR(255) NOT NULL DEFAULT '',
  smtp_secure   ENUM('none','tls','ssl') NOT NULL DEFAULT 'tls',
  from_name     VARCHAR(100) NOT NULL DEFAULT 'CRM System',
  from_email    VARCHAR(191) NOT NULL DEFAULT '',
  enabled       TINYINT(1) NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO email_settings (id) VALUES (1);

-- ─── Email templates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(100) NOT NULL UNIQUE,  -- e.g. 'welcome_user'
  name         VARCHAR(150) NOT NULL,         -- human label
  description  TEXT,                          -- what triggers this email
  subject      VARCHAR(255) NOT NULL,
  body_html    LONGTEXT NOT NULL,             -- HTML with {{variable}} placeholders
  variables    JSON,                          -- list of available {{vars}} for UI hint
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─── Seed default templates (3 only) ────────────────────────────────────────

INSERT IGNORE INTO email_templates (slug, name, description, subject, body_html, variables) VALUES
(
  'welcome_user',
  'Welcome / New User',
  'Sent when an admin creates a new user account.',
  'Welcome to {{company_name}} — Your account is ready',
  '<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#2563eb;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">{{company_name}}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">Welcome, {{first_name}}!</h2>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
            Your account has been created. Here are your login details:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Login URL</p>
              <p style="margin:0 0 16px;color:#2563eb;font-size:14px;">{{login_url}}</p>
              <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Email</p>
              <p style="margin:0 0 16px;color:#1e293b;font-size:14px;font-weight:600;">{{email}}</p>
              <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Temporary Password</p>
              <p style="margin:0;background:#1e293b;color:#f1f5f9;font-family:monospace;font-size:16px;padding:10px 14px;border-radius:6px;display:inline-block;">{{password}}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#ef4444;font-size:13px;">
            ⚠️ Please change your password after your first login.
          </p>
          <a href="{{login_url}}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">
            Sign In Now →
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
            This email was sent by {{company_name}}. If you did not expect this, please contact your administrator.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  JSON_ARRAY('{{first_name}}', '{{last_name}}', '{{email}}', '{{password}}', '{{login_url}}', '{{company_name}}')
),

(
  'password_reset',
  'Password Reset',
  'Sent when an admin resets a user password.',
  'Your {{company_name}} password has been reset',
  '<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#2563eb;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">{{company_name}}</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">Password Reset</h2>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
            Hi {{first_name}}, your password has been reset by an administrator.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;">New Password</p>
              <p style="margin:0;background:#1e293b;color:#f1f5f9;font-family:monospace;font-size:16px;padding:10px 14px;border-radius:6px;display:inline-block;">{{new_password}}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#ef4444;font-size:13px;">⚠️ Please change your password after logging in.</p>
          <a href="{{login_url}}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Sign In →</a>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">{{company_name}} · If you did not request this, contact your administrator.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  JSON_ARRAY('{{first_name}}', '{{new_password}}', '{{login_url}}', '{{company_name}}')
),

(
  'role_changed',
  'Role Changed',
  'Sent when a user role is changed by an admin.',
  'Your role has been updated on {{company_name}}',
  '<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#7c3aed;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">{{company_name}}</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">Your Role Has Been Updated</h2>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;">Hi {{first_name}}, your role on {{company_name}} has been changed.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Previous Role</p>
              <p style="margin:0 0 16px;color:#1e293b;font-size:14px;">{{from_role}}</p>
              <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">New Role</p>
              <p style="margin:0;color:#7c3aed;font-size:16px;font-weight:700;">{{to_role}}</p>
            </td></tr>
          </table>
          <a href="{{login_url}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Sign In →</a>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">{{company_name}}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  JSON_ARRAY('{{first_name}}', '{{from_role}}', '{{to_role}}', '{{login_url}}', '{{company_name}}')
);

-- If you already ran the old migration, remove the unused templates:
DELETE FROM email_templates WHERE slug IN ('task_assigned', 'task_approved', 'task_rejected');
