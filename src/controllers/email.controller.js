const db = require('../config/db');
const { testConnection, sendRawEmail } = require('../services/email.service');

// ─── GET /api/settings/email ──────────────────────────────────────────────────
exports.getEmailSettings = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM email_settings WHERE id = 1');
    if (!rows.length) return res.status(404).json({ message: 'Email settings not found' });

    // Never return the raw password — mask it
    const cfg = { ...rows[0] };
    if (cfg.smtp_pass) cfg.smtp_pass = '••••••••';
    return res.json(cfg);
  } catch (err) {
    console.error('getEmailSettings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/settings/email ──────────────────────────────────────────────────
exports.updateEmailSettings = async (req, res) => {
  const {
    smtp_host, smtp_port, smtp_user, smtp_pass,
    smtp_secure, from_name, from_email, enabled,
  } = req.body;

  try {
    const [existing] = await db.query('SELECT smtp_pass FROM email_settings WHERE id = 1');
    const currentPass = existing[0]?.smtp_pass || '';

    // If password field is the mask placeholder, keep the existing password
    const newPass = (smtp_pass && smtp_pass !== '••••••••') ? smtp_pass : currentPass;

    const validSecure = ['none', 'tls', 'ssl'];
    const secureVal   = validSecure.includes(smtp_secure) ? smtp_secure : 'tls';

    await db.query(
      `UPDATE email_settings
       SET smtp_host   = ?, smtp_port  = ?, smtp_user  = ?, smtp_pass  = ?,
           smtp_secure = ?, from_name  = ?, from_email = ?, enabled    = ?
       WHERE id = 1`,
      [
        smtp_host   || '',
        parseInt(smtp_port, 10) || 587,
        smtp_user   || '',
        newPass,
        secureVal,
        from_name   || 'CRM System',
        from_email  || '',
        enabled     ? 1 : 0,
      ]
    );

    return res.json({ message: 'Email settings saved' });
  } catch (err) {
    console.error('updateEmailSettings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/settings/email/test-connection ─────────────────────────────────
exports.testEmailConnection = async (req, res) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure } = req.body;

  if (!smtp_host || !smtp_user) {
    return res.status(400).json({ message: 'smtp_host and smtp_user are required' });
  }

  // If password is masked, load from DB
  let pass = smtp_pass;
  if (!pass || pass === '••••••••') {
    const [rows] = await db.query('SELECT smtp_pass FROM email_settings WHERE id = 1');
    pass = rows[0]?.smtp_pass || '';
  }

  try {
    await testConnection({ smtp_host, smtp_port, smtp_user, smtp_pass: pass, smtp_secure });
    return res.json({ success: true, message: 'Connection successful' });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── POST /api/settings/email/send-test ──────────────────────────────────────
exports.sendTestEmail = async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ message: 'Recipient email (to) is required' });

  try {
    await sendRawEmail({
      to,
      subject: 'CRM — Test Email',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:40px auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;">
          <h2 style="color:#2563eb;margin:0 0 16px;">✅ Test Email</h2>
          <p style="color:#475569;margin:0 0 8px;">This is a test email from your CRM system.</p>
          <p style="color:#475569;margin:0;">If you received this, your SMTP configuration is working correctly.</p>
        </div>
      `,
    });
    return res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// ─── GET /api/settings/email/templates ───────────────────────────────────────
exports.getTemplates = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, slug, name, description, subject, variables, is_active, updated_at FROM email_templates ORDER BY id'
    );
    // Parse variables JSON string → array (MySQL2 may return it as a string)
    const templates = rows.map(r => ({
      ...r,
      variables: (() => {
        if (Array.isArray(r.variables)) return r.variables;
        if (typeof r.variables === 'string') {
          try { return JSON.parse(r.variables); } catch { return []; }
        }
        return [];
      })(),
    }));
    return res.json(templates);
  } catch (err) {
    console.error('getTemplates error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/settings/email/templates/:slug ─────────────────────────────────
exports.getTemplate = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM email_templates WHERE slug = ?',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ message: 'Template not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('getTemplate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/settings/email/templates/:slug ─────────────────────────────────
exports.updateTemplate = async (req, res) => {
  const { subject, body_html, is_active } = req.body;
  const { slug } = req.params;

  if (!subject?.trim() || !body_html?.trim()) {
    return res.status(400).json({ message: 'subject and body_html are required' });
  }

  try {
    const [rows] = await db.query('SELECT id FROM email_templates WHERE slug = ?', [slug]);
    if (!rows.length) return res.status(404).json({ message: 'Template not found' });

    await db.query(
      'UPDATE email_templates SET subject = ?, body_html = ?, is_active = ? WHERE slug = ?',
      [subject.trim(), body_html.trim(), is_active !== false ? 1 : 0, slug]
    );

    return res.json({ message: 'Template updated' });
  } catch (err) {
    console.error('updateTemplate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/settings/email/templates/:slug/reset ──────────────────────────
// Resets a template to the seeded default by re-running the seed value.
// We store defaults in a separate lookup so they can always be restored.
// Only the 3 active templates have resettable defaults
const DEFAULT_SUBJECTS = {
  welcome_user:   'Welcome to {{company_name}} — Your account is ready',
  password_reset: 'Your {{company_name}} password has been reset',
  role_changed:   'Your role has been updated on {{company_name}}',
};

exports.resetTemplate = async (req, res) => {
  const { slug } = req.params;
  if (!DEFAULT_SUBJECTS[slug]) {
    return res.status(404).json({ message: 'Template not found' });
  }
  try {
    await db.query(
      'UPDATE email_templates SET subject = ?, is_active = 1 WHERE slug = ?',
      [DEFAULT_SUBJECTS[slug], slug]
    );
    return res.json({ message: 'Template subject reset to default. Re-run migration SQL to restore full body.' });
  } catch (err) {
    console.error('resetTemplate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
