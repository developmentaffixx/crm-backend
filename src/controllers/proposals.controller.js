const { validationResult } = require('express-validator');
const db  = require('../config/db');
const crypto = require('crypto');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function computeExpiry(validityDays) {
  if (!validityDays || validityDays <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + parseInt(validityDays));
  return d;
}

// Parse JSON fields from DB row
function parseJsonFields(row) {
  const jsonFields = ['pain_points', 'gaps', 'opportunities', 'goals', 'services_plans', 'ad_investment', 'investment_summary', 'why_us', 'custom_sections'];
  jsonFields.forEach(f => {
    if (row[f] && typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch (_) {}
    }
  });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM-SIDE (authenticated)
// ─────────────────────────────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND p.created_by = ?';
      params.push(req.user.id);
    }
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (p.title LIKE ? OR p.client_name LIKE ? OR p.client_company LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const allowedSort = ['created_at', 'title', 'client_name', 'status', 'view_count', 'expires_at'];
    const safeSortBy = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM proposals p WHERE ${where}`, params);
    const total = countRows[0].total;

    const [summaryRows] = await db.query(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN p.status='draft' THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN p.status='sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN p.status='viewed' THEN 1 ELSE 0 END) AS viewed,
        SUM(CASE WHEN p.status='accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN p.status='rejected' THEN 1 ELSE 0 END) AS rejected
       FROM proposals p WHERE ${where}`, params
    );

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT p.id, p.proposal_token, p.lead_id, p.title, p.tagline, p.client_name, p.client_company,
              p.brand_color, p.validity_days, p.expires_at, p.status,
              p.view_count, p.first_viewed_at, p.last_viewed_at, p.client_note, p.responded_at,
              p.prepared_by_name, p.created_by, p.created_at, p.updated_at,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              l.name AS lead_name, l.business_name AS lead_business_name
       FROM proposals p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN leads l ON l.id = p.lead_id
       WHERE ${where}
       ORDER BY p.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      proposals: rows,
      summary: summaryRows[0],
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('Proposals list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    lead_id, title, tagline, client_name, client_company, brand_color,
    pain_points, gaps, opportunities, goals, services_plans,
    ad_investment, investment_summary, why_us, custom_sections,
    validity_days, prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website
  } = req.body;

  try {
    const token = generateToken();
    const expiresAt = computeExpiry(validity_days || 7);

    const [result] = await db.query(
      `INSERT INTO proposals
        (proposal_token, lead_id, title, tagline, client_name, client_company, brand_color,
         pain_points, gaps, opportunities, goals, services_plans,
         ad_investment, investment_summary, why_us, custom_sections,
         validity_days, expires_at,
         prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website,
         status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        token, lead_id || null, title, tagline || null, client_name, client_company || null,
        brand_color || '#3b2314',
        pain_points ? JSON.stringify(pain_points) : null,
        gaps ? JSON.stringify(gaps) : null,
        opportunities ? JSON.stringify(opportunities) : null,
        goals ? JSON.stringify(goals) : null,
        services_plans ? JSON.stringify(services_plans) : null,
        ad_investment ? JSON.stringify(ad_investment) : null,
        investment_summary ? JSON.stringify(investment_summary) : null,
        why_us ? JSON.stringify(why_us) : null,
        custom_sections ? JSON.stringify(custom_sections) : null,
        validity_days || 7, expiresAt,
        prepared_by_name || null, prepared_by_email || null,
        prepared_by_phone || null, prepared_by_website || null,
        req.user.id,
      ]
    );

    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ?', [result.insertId]);
    const proposal = parseJsonFields(rows[0]);
    res.emitSocket('proposals:created', proposal);
    return res.status(201).json(proposal);
  } catch (err) {
    console.error('Proposals create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              l.name AS lead_name, l.business_name AS lead_business_name
       FROM proposals p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN leads l ON l.id = p.lead_id
       WHERE p.id = ? AND p.deleted = 0`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = parseJsonFields(rows[0]);
    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    return res.json(proposal);
  } catch (err) {
    console.error('Proposals getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = rows[0];
    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can edit' });
    }

    const directFields = ['lead_id', 'title', 'tagline', 'client_name', 'client_company', 'brand_color', 'validity_days', 'status', 'prepared_by_name', 'prepared_by_email', 'prepared_by_phone', 'prepared_by_website'];
    const jsonFields = ['pain_points', 'gaps', 'opportunities', 'goals', 'services_plans', 'ad_investment', 'investment_summary', 'why_us', 'custom_sections'];

    const updates = {};
    directFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    jsonFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = JSON.stringify(req.body[f]); });

    if (updates.validity_days) updates.expires_at = computeExpiry(updates.validity_days);
    if (updates.status === 'sent' && proposal.status === 'draft') {
      updates.expires_at = computeExpiry(proposal.validity_days || 7);
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No valid fields to update' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE proposals SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    const result = parseJsonFields(updated[0]);
    res.emitSocket('proposals:updated', result);
    return res.json(result);
  } catch (err) {
    console.error('Proposals update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    await db.query('UPDATE proposals SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('proposals:deleted', { id: req.params.id });
    return res.json({ message: 'Proposal deleted' });
  } catch (err) {
    console.error('Proposals remove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.markSent = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) return res.status(403).json({ message: 'Access denied' });

    if (rows[0].status === 'draft') {
      const expiresAt = computeExpiry(rows[0].validity_days || 7);
      await db.query("UPDATE proposals SET status = 'sent', expires_at = ? WHERE id = ?", [expiresAt, req.params.id]);
    }
    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    res.emitSocket('proposals:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Proposals markSent error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC (no auth)
// ─────────────────────────────────────────────────────────────────────────────

exports.getPublic = async (req, res) => {
  try {
    const { token } = req.params;
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM proposals p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.proposal_token = ? AND p.deleted = 0`, [token]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = parseJsonFields(rows[0]);

    // Check expiry
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return res.status(410).json({
        message: 'This proposal has expired', expired: true,
        client_name: proposal.client_name, title: proposal.title,
        prepared_by_name: proposal.prepared_by_name,
        prepared_by_email: proposal.prepared_by_email,
        prepared_by_phone: proposal.prepared_by_phone,
      });
    }

    // Log view
    const now = new Date();
    if (proposal.first_viewed_at) {
      db.query(`UPDATE proposals SET view_count = view_count + 1, last_viewed_at = ?, status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE id = ?`, [now, proposal.id]).catch(() => {});
    } else {
      db.query(`UPDATE proposals SET view_count = view_count + 1, first_viewed_at = ?, last_viewed_at = ?, status = CASE WHEN status IN ('draft','sent') THEN 'viewed' ELSE status END WHERE id = ?`, [now, now, proposal.id]).catch(() => {});
    }

    // Socket notify
    try {
      const { getIO } = require('../config/socket');
      getIO().emit('proposals:viewed', { id: proposal.id, view_count: (proposal.view_count || 0) + 1 });
    } catch (_) {}

    // Return (exclude internal fields)
    const { deleted, created_by, ...publicData } = proposal;
    return res.json(publicData);
  } catch (err) {
    console.error('Proposals getPublic error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.respond = async (req, res) => {
  try {
    const { token } = req.params;
    const { action, client_note } = req.body;
    if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ message: 'Action must be accepted or rejected' });

    const [rows] = await db.query('SELECT * FROM proposals WHERE proposal_token = ? AND deleted = 0', [token]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = rows[0];
    if (['accepted', 'rejected'].includes(proposal.status)) {
      return res.status(400).json({ message: `Already ${proposal.status}`, status: proposal.status });
    }
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return res.status(410).json({ message: 'Proposal expired', expired: true });
    }

    await db.query('UPDATE proposals SET status = ?, client_note = ?, responded_at = NOW() WHERE id = ?', [action, client_note || null, proposal.id]);

    try {
      const { getIO } = require('../config/socket');
      getIO().emit('proposals:responded', { id: proposal.id, status: action, client_note });
    } catch (_) {}

    return res.json({ message: `Proposal ${action} successfully`, status: action });
  } catch (err) {
    console.error('Proposals respond error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
