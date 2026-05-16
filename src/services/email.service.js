const nodemailer = require('nodemailer');
const db = require('../config/db');

/**
 * Load SMTP settings from DB and create a transporter.
 * Returns null if email is disabled or not configured.
 */
async function getTransporter() {
  const [rows] = await db.query('SELECT * FROM email_settings WHERE id = 1');
  if (!rows.length) return null;

  const cfg = rows[0];
  if (!cfg.enabled || !cfg.smtp_host || !cfg.smtp_user) return null;

  const secure = cfg.smtp_secure === 'ssl';
  const tls    = cfg.smtp_secure === 'none' ? { rejectUnauthorized: false } : undefined;

  return {
    transporter: nodemailer.createTransport({
      host:   cfg.smtp_host,
      port:   cfg.smtp_port,
      secure,
      auth:   { user: cfg.smtp_user, pass: cfg.smtp_pass },
      tls,
    }),
    from: `"${cfg.from_name}" <${cfg.from_email || cfg.smtp_user}>`,
  };
}

/**
 * Replace {{variable}} placeholders in a string.
 */
function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * Send an email using a named template slug.
 * @param {string} slug       - template slug e.g. 'welcome_user'
 * @param {string} toEmail    - recipient email
 * @param {object} vars       - variables to interpolate into subject + body
 * @returns {{ sent: boolean, error?: string }}
 */
async function sendTemplateEmail(slug, toEmail, vars = {}) {
  try {
    const result = await getTransporter();
    if (!result) return { sent: false, error: 'Email is disabled or not configured' };

    const { transporter, from } = result;

    const [rows] = await db.query(
      'SELECT subject, body_html, is_active FROM email_templates WHERE slug = ?',
      [slug]
    );
    if (!rows.length)          return { sent: false, error: `Template "${slug}" not found` };
    if (!rows[0].is_active)    return { sent: false, error: `Template "${slug}" is disabled` };

    const subject = interpolate(rows[0].subject,  vars);
    const html    = interpolate(rows[0].body_html, vars);

    await transporter.sendMail({ from, to: toEmail, subject, html });
    return { sent: true };
  } catch (err) {
    console.error(`sendTemplateEmail(${slug}) error:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send a raw email (used for test send).
 */
async function sendRawEmail({ to, subject, html }) {
  const result = await getTransporter();
  if (!result) throw new Error('Email is disabled or not configured');
  const { transporter, from } = result;
  await transporter.sendMail({ from, to, subject, html });
}

/**
 * Test SMTP connection without sending.
 */
async function testConnection(cfg) {
  const secure = cfg.smtp_secure === 'ssl';
  const tls    = cfg.smtp_secure === 'none' ? { rejectUnauthorized: false } : undefined;

  const transporter = nodemailer.createTransport({
    host:   cfg.smtp_host,
    port:   parseInt(cfg.smtp_port, 10),
    secure,
    auth:   { user: cfg.smtp_user, pass: cfg.smtp_pass },
    tls,
    connectionTimeout: 8000,
    greetingTimeout:   8000,
  });

  await transporter.verify();
}

module.exports = { sendTemplateEmail, sendRawEmail, testConnection, interpolate };
