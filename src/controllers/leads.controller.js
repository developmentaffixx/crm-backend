const { validationResult } = require('express-validator');
const db = require('../config/db');

/**
 * GET /api/leads/dropdown
 * Lightweight list for dropdowns — returns id, name, business_name only
 */
exports.dropdown = async (req, res) => {
  try {
    let where = 'deleted = 0';
    const params = [];

    // Non-admin: only see leads assigned to or created by them
    if (!req.user.is_admin) {
      where += ' AND (assigned_to = ? OR created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT id, name, business_name FROM leads WHERE ${where} ORDER BY business_name ASC, name ASC`,
      params
    );

    return res.json({ leads: rows });
  } catch (err) {
    console.error('Leads dropdown error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── Helper: Generate Lead ID (LD-YYMMDD-###) — Race-condition safe ──────────
async function generateLeadId(connection) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yearMonth = `${yy}${mm}`;
  const prefix = `LD-${yy}${mm}${dd}`;

  // Atomic increment using INSERT ... ON DUPLICATE KEY UPDATE
  const conn = connection || db;
  await conn.query(
    `INSERT INTO lead_id_sequence (ym_key, last_seq) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    [yearMonth]
  );

  const [rows] = await conn.query(
    'SELECT last_seq FROM lead_id_sequence WHERE ym_key = ?',
    [yearMonth]
  );
  const seq = String(rows[0].last_seq).padStart(3, '0');
  return `${prefix}-${seq}`;
}

/**
 * GET /api/leads
 * Supports: search, temperature, source, status filters
 * Supports: pagination (page, limit)
 * Supports: sorting (sortBy, sortOrder)
 */
exports.list = async (req, res) => {
  try {
    const { temperature, source, status, search, page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    let where = 'l.deleted = 0';
    const params = [];

    if (temperature) { where += ' AND l.temperature = ?'; params.push(temperature); }
    if (source)      { where += ' AND l.source = ?';      params.push(source); }
    if (status)      { where += ' AND l.status = ?';      params.push(status); }
    if (search) {
      where += ' AND (l.name LIKE ? OR l.business_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.lead_id LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    // Non-admin: only see leads assigned to or created by them
    if (!req.user.is_admin) {
      where += ' AND (l.assigned_to = ? OR l.created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    // Validate sortBy to prevent SQL injection
    const allowedSortColumns = ['created_at', 'name', 'business_name', 'status', 'temperature', 'source', 'lead_id'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Get total count for pagination
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM leads l WHERE ${where}`,
      params
    );
    const total = countResult[0].total;

    // Get summary counts (from full filtered set, not paginated)
    const [summaryRows] = await db.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN l.temperature = 'hot' THEN 1 ELSE 0 END) AS hot,
        SUM(CASE WHEN l.temperature = 'warm' THEN 1 ELSE 0 END) AS warm,
        SUM(CASE WHEN l.temperature = 'cold' THEN 1 ELSE 0 END) AS cold
       FROM leads l WHERE ${where}`,
      params
    );
    const summary = {
      total: summaryRows[0].total || 0,
      hot: summaryRows[0].hot || 0,
      warm: summaryRows[0].warm || 0,
      cold: summaryRows[0].cold || 0,
    };

    // Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE ${where}
       ORDER BY l.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      leads: rows,
      summary,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
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

    // Fetch status history
    const [statusHistory] = await db.query(
      `SELECT h.*, CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
       FROM lead_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.lead_id = ?
       ORDER BY h.changed_at DESC`,
      [lead.id]
    );
    lead.status_history = statusHistory;

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
    // Generate lead_id (race-condition safe)
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

    // Record initial status in history
    await db.query(
      'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
      [leadId, '', status || 'New', req.user.id]
    );

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

    // Track status change
    if (updates.status && updates.status !== lead.status) {
      await db.query(
        'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
        [req.params.id, lead.status, updates.status, req.user.id]
      );
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
 * PATCH /api/leads/:id/status — Quick status change (without full edit)
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'Status is required' });

    const validStatuses = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const lead = rows[0];
    if (!req.user.is_admin && lead.created_by !== req.user.id && lead.assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (lead.status === status) {
      return res.json({ message: 'Status unchanged', lead });
    }

    // Record status change history
    await db.query(
      'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
      [req.params.id, lead.status, status, req.user.id]
    );

    await db.query('UPDATE leads SET status = ? WHERE id = ?', [status, req.params.id]);

    const [updated] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Lead updateStatus error:', err);
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

/**
 * GET /api/leads/reminders/upcoming
 * Returns follow-ups that are due today or overdue (for notification bell)
 */
exports.getFollowUpReminders = async (req, res) => {
  try {
    let userFilter = '';
    const params = [];

    // Non-admin: only see reminders for leads assigned to or created by them
    if (!req.user.is_admin) {
      userFilter = 'AND (l.assigned_to = ? OR l.created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    const [reminders] = await db.query(
      `SELECT f.id, f.lead_id, f.type, f.note, f.follow_up_date, f.created_at,
              l.name AS lead_name, l.lead_id AS lead_code,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              DATEDIFF(CURDATE(), DATE(f.follow_up_date)) AS days_overdue
       FROM lead_follow_ups f
       JOIN leads l ON l.id = f.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.follow_up_date IS NOT NULL
         AND DATE(f.follow_up_date) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
         AND DATE(f.follow_up_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         ${userFilter}
       ORDER BY f.follow_up_date ASC
       LIMIT 20`,
      params
    );

    return res.json({ reminders, count: reminders.length });
  } catch (err) {
    console.error('Follow-up reminders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── Helper: Generate Client Code (AFXCL###) ─────────────────────────────────
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

    // Record status change
    await db.query(
      'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
      [req.params.id, lead.status, 'Won', req.user.id]
    );

    await db.query("UPDATE leads SET status = 'Won', client_code = ? WHERE id = ?", [client_code, req.params.id]);

    const [updated] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:updated', updated[0]);
    return res.json({ message: 'Lead converted to client successfully', lead: updated[0] });
  } catch (err) {
    console.error('Lead convert error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
