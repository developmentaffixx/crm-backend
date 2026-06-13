const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { sendRawEmail } = require('../services/email.service');

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate next AFID by reading the highest existing one from the shared DB.
 * Format: AFID-0001, AFID-0002, …
 */
async function generateAfid() {
  const [rows] = await db.query(
    `SELECT afid FROM pillars_candidate_registration ORDER BY id DESC LIMIT 1`
  );
  if (!rows.length) return 'AFID0001';

  const last = rows[0].afid; // e.g. "AFID0042"
  const num  = parseInt(last.replace('AFID-', '').replace('AFID', ''), 10) || 0;
  return `AFID${String(num + 1).padStart(4, '0')}`;
}

/**
 * Generate a random 8-char alphanumeric password.
 */
function generatePassword(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

/**
 * Send invitation email to candidate.
 */
async function sendInvitationEmail(toEmail, candidateName, afid, password) {
  const loginUrl = 'https://pillaronboard.affixxmedia.com';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div style="background:#2563eb;padding:28px 32px;">
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Welcome to Affixx Media</h1>
        <p style="color:#bfdbfe;margin:6px 0 0;font-size:14px;">Your onboarding invitation</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#1e293b;font-size:15px;margin:0 0 20px;">Hi <strong>${candidateName}</strong>,</p>
        <p style="color:#475569;font-size:14px;margin:0 0 24px;">
          You have been invited to complete your employee onboarding. Please use the credentials below to log in and fill in your details.
        </p>

        <div style="background:#f1f5f9;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="color:#64748b;font-size:13px;padding:6px 0;width:120px;">Login URL</td>
              <td style="color:#2563eb;font-size:13px;font-weight:600;padding:6px 0;">
                <a href="${loginUrl}" style="color:#2563eb;">${loginUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;padding:6px 0;">AFID</td>
              <td style="color:#1e293b;font-size:14px;font-weight:700;padding:6px 0;font-family:monospace;">${afid}</td>
            </tr>
            <tr>
              <td style="color:#64748b;font-size:13px;padding:6px 0;">Password</td>
              <td style="color:#1e293b;font-size:14px;font-weight:700;padding:6px 0;font-family:monospace;">${password}</td>
            </tr>
          </table>
        </div>

        <a href="${loginUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          Start Onboarding →
        </a>

        <p style="color:#94a3b8;font-size:12px;margin:28px 0 0;">
          This link is valid for 24 hours. If you have any issues, please contact HR.
        </p>
      </div>
    </div>
  `;

  return sendRawEmail({
    to: toEmail,
    subject: `Your Onboarding Invitation — ${afid}`,
    html,
  });
}

// ── GET /api/onboarding ───────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    let whereClause = ` WHERE r.deleted = 0 `;
    const params = [];

    if (search) {
      whereClause += ` AND (r.candidate_name LIKE ? OR r.email LIKE ? OR r.afid LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (status) {
      whereClause += ` AND COALESCE(d.onboarding_status, 'pending') = ?`;
      params.push(status);
    }

    // Count query
    const countSql = `
      SELECT COUNT(*) AS total
      FROM pillars_candidate_registration r
      LEFT JOIN pillars_candidate_details d ON d.afid = r.afid AND d.deleted = 0
      ${whereClause}
    `;
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    // Data query with pagination
    const dataSql = `
      SELECT
        r.id,
        r.afid,
        r.candidate_name,
        r.email,
        r.created_at AS invited_at,
        COALESCE(d.onboarding_status, 'pending') AS status,
        d.progress_percentage,
        d.submitted_at
      FROM pillars_candidate_registration r
      LEFT JOIN pillars_candidate_details d ON d.afid = r.afid AND d.deleted = 0
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(dataSql, [...params, limitNum, offset]);

    return res.json({
      candidates: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('onboarding list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/onboarding ──────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { candidate_name, email } = req.body;

    if (!candidate_name?.trim() || !email?.trim()) {
      return res.status(400).json({ message: 'Candidate name and email are required' });
    }

    // Check duplicate email
    const [existing] = await db.query(
      `SELECT id FROM pillars_candidate_registration WHERE email = ? AND deleted = 0`,
      [email.trim().toLowerCase()]
    );
    if (existing.length) {
      return res.status(409).json({ message: 'A candidate with this email already exists' });
    }

    const afid     = await generateAfid();
    const password = generatePassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert candidate registration (store hashed password)
    await db.query(
      `INSERT INTO pillars_candidate_registration
         (afid, candidate_name, email, password, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [afid, candidate_name.trim(), email.trim().toLowerCase(), hashedPassword]
    );

    // Send invitation email (non-blocking — don't fail if email fails)
    let emailSent = false;
    try {
      await sendInvitationEmail(email.trim(), candidate_name.trim(), afid, password);
      emailSent = true;
    } catch (emailErr) {
      console.error('Invitation email failed:', emailErr.message);
    }

    return res.status(201).json({
      message: 'Candidate created successfully',
      afid,
      emailSent,
    });
  } catch (err) {
    console.error('onboarding create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/onboarding/:afid ─────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const { afid } = req.params;

    const [regRows] = await db.query(
      `SELECT id, afid, candidate_name, email, created_at AS invited_at
       FROM pillars_candidate_registration
       WHERE afid = ? AND deleted = 0`,
      [afid]
    );
    if (!regRows.length) return res.status(404).json({ message: 'Candidate not found' });

    const [detRows] = await db.query(
      `SELECT * FROM pillars_candidate_details WHERE afid = ? AND deleted = 0`,
      [afid]
    );

    const reg = regRows[0];
    const det = detRows[0] || null;

    // Parse all JSON fields safely
    const parse = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try { return JSON.parse(val); } catch { return null; }
    };

    return res.json({
      afid:               reg.afid,
      candidate_name:     reg.candidate_name,
      email:              reg.email,
      invited_at:         reg.invited_at,
      status:             det?.onboarding_status || 'pending',
      progress_percentage: det?.progress_percentage || 0,
      submitted_at:       det?.submitted_at || null,
      applicant_data:     parse(det?.applicant_data),
      personal_data:      parse(det?.personal_data),
      address_data:       parse(det?.address_data),
      education_data:     parse(det?.education_data),
      experience_data:    parse(det?.experience_data),
      emergency_data:     parse(det?.emergency_data),
      documents:          parse(det?.documents),
    });
  } catch (err) {
    console.error('onboarding getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── PATCH /api/onboarding/:afid/status ───────────────────────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { afid } = req.params;
    const { status } = req.body;

    const allowed = ['pending', 'in_progress', 'completed', 'approved', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const [rows] = await db.query(
      `SELECT id FROM pillars_candidate_details WHERE afid = ? AND deleted = 0`,
      [afid]
    );
    if (!rows.length) return res.status(404).json({ message: 'Candidate details not found' });

    await db.query(
      `UPDATE pillars_candidate_details SET onboarding_status = ?, updated_at = NOW() WHERE afid = ?`,
      [status, afid]
    );

    return res.json({ message: 'Status updated' });
  } catch (err) {
    console.error('onboarding updateStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/onboarding/:afid/resend ────────────────────────────────────────
exports.resend = async (req, res) => {
  try {
    const { afid } = req.params;

    const [rows] = await db.query(
      `SELECT candidate_name, email FROM pillars_candidate_registration
       WHERE afid = ? AND deleted = 0`,
      [afid]
    );
    if (!rows.length) return res.status(404).json({ message: 'Candidate not found' });

    const { candidate_name, email } = rows[0];

    // Generate a new password, hash it, and update the record
    const newPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query(
      `UPDATE pillars_candidate_registration SET password = ? WHERE afid = ?`,
      [hashedPassword, afid]
    );

    try {
      await sendInvitationEmail(email, candidate_name, afid, newPassword);
    } catch (emailErr) {
      return res.status(500).json({ message: 'Failed to send email: ' + emailErr.message });
    }

    return res.json({ message: 'Invitation resent with a new password' });
  } catch (err) {
    console.error('onboarding resend error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
