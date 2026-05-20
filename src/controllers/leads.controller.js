const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─── Helper: Generate Lead ID (LD-YYMMDD-###) ────────────────────────────────
// Sequence resets monthly per the ID structure rules
async function generateLeadId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `LD-${yy}${mm}${dd}`;

  // Count leads created this month to get next sequence (resets monthly)
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM leads WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) AND lead_id IS NOT NULL`
  );
  const seq = String((rows[0]?.cnt || 0) + 1).padStart(3, '0');
  return `${prefix}-${seq}`;
}

/**
 * GET /api/leads
 */
exports.list = async (req, res) => {
  try {
    const { temperature, source, status, search } = req.query;
    let where = 'l.deleted = 0';
    const params = [];

    if (temperature) { where += ' AND l.temperature = ?'; params.push(temperature); }
    if (source)      { where += ' AND l.source = ?';      params.push(source); }
    if (status)      { where += ' AND l.status = ?';      params.push(status); }
    if (search) {
      where += ' AND (l.name LIKE ? OR l.business_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    // Non-admin: only see leads assigned to or created by them
    if (!req.user.is_admin) {
      where += ' AND (l.assigned_to = ? OR l.created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE ${where}
       ORDER BY l.created_at DESC`,
      params
    );

    // Summary counts
    const summary = {
      total: rows.length,
      hot:   rows.filter(r => r.temperature === 'hot').length,
      warm:  rows.filter(r => r.temperature === 'warm').length,
      cold:  rows.filter(r => r.temperature === 'cold').length,
    };

    return res.json({ leads: rows, summary });
  } catch (err) {
    console.error('Leads list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/leads/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE l.id = ? AND l.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const lead = rows[0];

    // Non-admin access check
    if (!req.user.is_admin && lead.assigned_to !== req.user.id && lead.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch social links
    const [links] = await db.query('SELECT * FROM lead_social_links WHERE lead_id = ?', [lead.id]);
    lead.social_links = links;

    // Fetch follow-ups
    const [followUps] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = ?
       ORDER BY f.created_at DESC`,
      [lead.id]
    );
    lead.follow_ups = followUps;

    return res.json(lead);
  } catch (err) {
    console.error('Lead getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/leads
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    name, business_name, service_required, budget_min, budget_max, no_budget_idea,
    purpose_of_services, phone, email, address, country, state, city, zip_code,
    temperature, source, status, current_marketing_status, assigned_to, social_links
  } = req.body;

  try {
    // Generate lead_id
    const lead_id = await generateLeadId();

    const [result] = await db.query(
      `INSERT INTO leads (lead_id, name, business_name, service_required, budget_min, budget_max, no_budget_idea,
        purpose_of_services, phone, email, address, country, state, city, zip_code,
        temperature, source, status, current_marketing_status, assigned_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        name, business_name || null, service_required || null,
        no_budget_idea ? null : (budget_min || null),
        no_budget_idea ? null : (budget_max || null),
        no_budget_idea ? 1 : 0,
        purpose_of_services || null, phone || null, email || null,
        address || null, country || null, state || null, city || null, zip_code || null,
        temperature || 'cold', source || null, status || 'New',
        current_marketing_status || null, assigned_to || null, req.user.id
      ]
    );

    const leadId = result.insertId;

    // Insert social links
    if (social_links && social_links.length > 0) {
      const linkValues = social_links
        .filter(sl => sl.platform && sl.url)
        .map(sl => [leadId, sl.platform, sl.url]);
      if (linkValues.length > 0) {
        await db.query(
          'INSERT INTO lead_social_links (lead_id, platform, url) VALUES ?',
          [linkValues]
        );
      }
    }

    const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [leadId]);
    res.emitSocket('leads:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Lead create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leads/:id
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const lead = rows[0];
    if (!req.user.is_admin && lead.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can edit this lead' });
    }

    const allowed = [
      'name', 'business_name', 'service_required', 'budget_min', 'budget_max', 'no_budget_idea',
      'purpose_of_services', 'phone', 'email', 'address', 'country', 'state', 'city', 'zip_code',
      'temperature', 'source', 'status', 'current_marketing_status', 'assigned_to'
    ];

    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Handle no_budget_idea logic
    if (updates.no_budget_idea) {
      updates.budget_min = null;
      updates.budget_max = null;
    }

    if (Object.keys(updates).length === 0 && !req.body.social_links) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), req.params.id];
      await db.query(`UPDATE leads SET ${setClauses} WHERE id = ?`, values);
    }

    // Update social links (replace all)
    if (req.body.social_links !== undefined) {
      await db.query('DELETE FROM lead_social_links WHERE lead_id = ?', [req.params.id]);
      const links = req.body.social_links.filter(sl => sl.platform && sl.url);
      if (links.length > 0) {
        const linkValues = links.map(sl => [req.params.id, sl.platform, sl.url]);
        await db.query('INSERT INTO lead_social_links (lead_id, platform, url) VALUES ?', [linkValues]);
      }
    }

    const [updated] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Lead update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/leads/:id (soft delete)
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const lead = rows[0];
    if (!req.user.is_admin && lead.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can delete this lead' });
    }

    await db.query('UPDATE leads SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:deleted', { id: req.params.id });
    return res.json({ message: 'Lead deleted' });
  } catch (err) {
    console.error('Lead delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/leads/:id/follow-ups
 */
exports.addFollowUp = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const { note, follow_up_date, type } = req.body;

    const [result] = await db.query(
      'INSERT INTO lead_follow_ups (lead_id, type, note, follow_up_date, created_by) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, type || 'Phone Call', note, follow_up_date || null, req.user.id]
    );

    const [followUp] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(followUp[0]);
  } catch (err) {
    console.error('Follow-up create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/leads/:id/follow-ups
 */
exports.getFollowUps = async (req, res) => {
  try {
    const [followUps] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = ?
       ORDER BY f.created_at DESC`,
      [req.params.id]
    );
    return res.json(followUps);
  } catch (err) {
    console.error('Follow-ups list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── Helper: Generate Client Code (AFXCL###) ─────────────────────────────────
// Never resets (per system rules)
async function generateClientCode() {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM leads WHERE client_code IS NOT NULL`
  );
  const seq = String((rows[0]?.cnt || 0) + 1).padStart(3, '0');
  return `AFXCL${seq}`;
}

/**
 * POST /api/leads/:id/convert
 * Convert a lead to client (set status = 'Won') — Admin only
 */
exports.convert = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin can convert leads to clients' });
    }

    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const lead = rows[0];
    if (lead.status === 'Won') {
      return res.status(400).json({ message: 'Lead is already converted to client' });
    }

    // Generate client code
    const client_code = await generateClientCode();

    await db.query("UPDATE leads SET status = 'Won', client_code = ? WHERE id = ?", [client_code, req.params.id]);

    const [updated] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:updated', updated[0]);
    return res.json({ message: 'Lead converted to client successfully', lead: updated[0] });
  } catch (err) {
    console.error('Lead convert error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
