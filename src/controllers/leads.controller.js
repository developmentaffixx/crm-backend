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

// ─── Helper: Get Financial Year key (Apr–Mar), e.g. "2627" for FY 2026-27 ────
function getFinancialYearKey(date) {
  const month = date.getMonth() + 1; // 1–12
  const year = date.getFullYear();
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  return `${String(fyStart).slice(-2)}${String(fyEnd).slice(-2)}`; // e.g. "2627"
}

// ─── Helper: Generate Lead ID (LD-YYMMDD-###) — Race-condition safe ──────────
async function generateLeadId(connection, customDate) {
  const now = customDate ? new Date(customDate) : new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const fyKey = getFinancialYearKey(now); // e.g. "2627" for FY Apr 2026–Mar 2027
  const prefix = `LD-${yy}${mm}${dd}`;

  // Atomic increment using INSERT ... ON DUPLICATE KEY UPDATE
  const conn = connection || db;
  await conn.query(
    `INSERT INTO lead_id_sequence (ym_key, last_seq) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    [fyKey]
  );

  const [rows] = await conn.query(
    'SELECT last_seq FROM lead_id_sequence WHERE ym_key = ?',
    [fyKey]
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
    const { temperature, source, status, search, page = 1, limit = 50, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
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
    name, business_name, industry, service_required, budget_min, budget_max, no_budget_idea,
    purpose_of_services, phone, email, address, country, state, city, zip_code,
    temperature, source, status, current_marketing_status, assigned_to, social_links,
    resource, initial_followup, created_at,
    lead_stage, lead_score, expected_revenue, next_action, interested_services
  } = req.body;

  try {
    // Generate lead_id (race-condition safe) — uses custom date if provided
    const lead_id = await generateLeadId(null, created_at || null);

    const [result] = await db.query(
      `INSERT INTO leads (lead_id, name, business_name, industry, service_required, budget_min, budget_max, no_budget_idea,
        purpose_of_services, phone, email, address, country, state, city, zip_code,
        temperature, source, resource, status, current_marketing_status, assigned_to, created_by, created_at,
        lead_stage, lead_score, expected_revenue, next_action, interested_services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        name, business_name || null, industry || null, service_required || null,
        no_budget_idea ? null : (budget_min || null),
        no_budget_idea ? null : (budget_max || null),
        no_budget_idea ? 1 : 0,
        purpose_of_services || null, phone || null, email || null,
        address || null, country || null, state || null, city || null, zip_code || null,
        temperature || 'cold', source || null, resource || null, status || 'New',
        current_marketing_status || null, assigned_to || null, req.user.id,
        created_at ? new Date(created_at) : new Date(),
        lead_stage || 'Cold', lead_score || 1, expected_revenue || null,
        next_action || null,
        interested_services ? (Array.isArray(interested_services) ? interested_services.join(',') : interested_services) : null
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

    // Insert initial follow-up if provided
    if (initial_followup && initial_followup.trim()) {
      await db.query(
        'INSERT INTO lead_follow_ups (lead_id, type, note, created_by) VALUES (?, ?, ?, ?)',
        [leadId, 'Initial Follow-up', initial_followup.trim(), req.user.id]
      );
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
      'name', 'business_name', 'industry', 'service_required', 'budget_min', 'budget_max', 'no_budget_idea',
      'purpose_of_services', 'phone', 'email', 'address', 'country', 'state', 'city', 'zip_code',
      'temperature', 'source', 'resource', 'status', 'current_marketing_status', 'assigned_to',
      'lead_stage', 'lead_score', 'expected_revenue', 'next_action', 'interested_services'
    ];

    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) {
        // Handle interested_services array → comma-separated string
        if (f === 'interested_services' && Array.isArray(req.body[f])) {
          updates[f] = req.body[f].join(',');
        } else {
          updates[f] = req.body[f];
        }
      }
    });

    // Handle created_at change — regenerate lead_id based on new date
    if (req.body.created_at) {
      const newDate = new Date(req.body.created_at);
      const existingDate = new Date(lead.created_at);
      // Only regenerate lead_id if the date actually changed (different month or day)
      if (newDate.toISOString().split('T')[0] !== existingDate.toISOString().split('T')[0]) {
        const newLeadId = await generateLeadId(null, req.body.created_at);
        updates.lead_id = newLeadId;
        updates.created_at = newDate;

        // Recalculate the old financial year's sequence counter
        const oldFyKey = getFinancialYearKey(existingDate);
        const oldFyStartYy = String(parseInt('20' + oldFyKey.slice(0, 2))).slice(-2);

        // Count how many leads still exist in the old FY (excluding current lead)
        // FY Apr YYYY – Mar YYYY+1: lead_id starts with LD-YY where YY is fyStart or fyEnd year
        const [countRows] = await db.query(
          `SELECT COUNT(*) AS cnt FROM leads
           WHERE deleted = 0 AND id != ?
           AND (
             lead_id LIKE ? OR lead_id LIKE ?
           )`,
          [
            req.params.id,
            `LD-${oldFyStartYy}%`,                          // e.g. LD-26...
            `LD-${String(parseInt(oldFyStartYy) + 1).padStart(2,'0')}0[1-3]%`  // e.g. LD-27 Jan–Mar
          ]
        );
        const oldFyCount = countRows[0].cnt;
        // Update the sequence counter for old financial year
        await db.query(
          'UPDATE lead_id_sequence SET last_seq = ? WHERE ym_key = ?',
          [oldFyCount, oldFyKey]
        );
      }
    }

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

    // If status is being set to 'Won', generate client_code (same as convert endpoint)
    if (status === 'Won' && !lead.client_code) {
      const client_code = await generateClientCode();
      await db.query('UPDATE leads SET status = ?, client_code = ? WHERE id = ?', [status, client_code, req.params.id]);
    } else {
      await db.query('UPDATE leads SET status = ? WHERE id = ?', [status, req.params.id]);
    }

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

// ─── Helper: Auto-derive lead_stage and lead_score from follow-up outcome ─────
function deriveStageAndScore(outcome) {
  const map = {
    'No Response':                  { stage: 'Contacted',         score: 1 },
    'Callback Requested':           { stage: 'Contacted',         score: 2 },
    'Follow-Up Needed':             { stage: 'Contacted',         score: 2 },
    'Warm Lead':                    { stage: 'Replied',           score: 3 },
    'Interested':                   { stage: 'Interested',        score: 3 },
    'Hot Lead':                     { stage: 'Interested',        score: 4 },
    'Proposal Requested':           { stage: 'Qualified',         score: 4 },
    'Meeting Scheduled':            { stage: 'Meeting Scheduled', score: 4 },
    'Negotiation Stage':            { stage: 'Negotiation',       score: 4 },
    'Decision Pending':             { stage: 'Negotiation',       score: 4 },
    'Budget Issue':                 { stage: 'Negotiation',       score: 3 },
    'Timing Issue':                 { stage: 'Negotiation',       score: 3 },
    'Already Working With Agency':  { stage: 'Lost',              score: 1 },
    'Not Interested':               { stage: 'Lost',              score: 1 },
    'Converted':                    { stage: 'Won',               score: 5 },
  };
  return map[outcome] || null;
}

/**
 * POST /api/leads/:id/follow-ups
 */
exports.addFollowUp = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const { note, follow_up_date, type, outcome, created_at, lead_stage, lead_score, next_action } = req.body;

    const [result] = await db.query(
      'INSERT INTO lead_follow_ups (lead_id, type, outcome, note, follow_up_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, type || 'Phone Call', outcome || null, note, follow_up_date || null, req.user.id, created_at || new Date()]
    );

    // Auto-update lead stage & score from outcome, unless manually overridden
    const auto = outcome ? deriveStageAndScore(outcome) : null;
    const leadUpdates = {};

    if (lead_stage) {
      leadUpdates.lead_stage = lead_stage; // manual override takes priority
    } else if (auto?.stage) {
      // Only auto-advance — never go backwards (except to Lost/Won)
      const stageOrder = ['Cold','Contacted','Replied','Interested','Qualified','Meeting Scheduled','Proposal Sent','Negotiation','Won','Lost'];
      const [currentLead] = await db.query('SELECT lead_stage, lead_score FROM leads WHERE id = ?', [req.params.id]);
      const currentStageIdx = stageOrder.indexOf(currentLead[0]?.lead_stage || 'Cold');
      const newStageIdx = stageOrder.indexOf(auto.stage);
      // Always allow Won/Lost; otherwise only advance forward
      if (auto.stage === 'Won' || auto.stage === 'Lost' || newStageIdx > currentStageIdx) {
        leadUpdates.lead_stage = auto.stage;
      }
    }

    if (lead_score) {
      leadUpdates.lead_score = lead_score; // manual override
    } else if (auto?.score) {
      // Only increase score, never decrease (except on Lost)
      const [currentLead] = await db.query('SELECT lead_score FROM leads WHERE id = ?', [req.params.id]);
      const currentScore = currentLead[0]?.lead_score || 1;
      if (outcome === 'Not Interested' || outcome === 'Already Working With Agency') {
        leadUpdates.lead_score = 1; // reset on loss
      } else if (auto.score > currentScore) {
        leadUpdates.lead_score = auto.score;
      }
    }

    if (next_action) leadUpdates.next_action = next_action;
    else if (auto?.stage) {
      // Auto-suggest next action based on stage
      const nextActionMap = {
        'Contacted':         'Follow-Up Call',
        'Replied':           'Follow-Up Call',
        'Interested':        'Schedule Meeting',
        'Qualified':         'Send Proposal',
        'Meeting Scheduled': 'Send Proposal',
        'Proposal Sent':     'Waiting for Client',
        'Negotiation':       'Send Pricing',
        'Won':               null,
        'Lost':              null,
      };
      const suggested = nextActionMap[leadUpdates.lead_stage || auto.stage];
      if (suggested) leadUpdates.next_action = suggested;
    }

    if (Object.keys(leadUpdates).length > 0) {
      const setClauses = Object.keys(leadUpdates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(leadUpdates), req.params.id];
      await db.query(`UPDATE leads SET ${setClauses} WHERE id = ?`, values);
    }

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
 * PUT /api/leads/:id/follow-ups/:followUpId — Update a follow-up
 */
exports.updateFollowUp = async (req, res) => {
  try {
    const { id, followUpId } = req.params;

    const [rows] = await db.query('SELECT * FROM lead_follow_ups WHERE id = ? AND lead_id = ?', [followUpId, id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Follow-up not found' });

    const followUp = rows[0];

    // Only the creator or admin can edit
    if (!req.user.is_admin && followUp.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can edit this follow-up' });
    }

    const { type, note, outcome, follow_up_date, created_at } = req.body;

    const updates = {};
    if (type !== undefined) updates.type = type;
    if (outcome !== undefined) updates.outcome = outcome || null;
    if (note !== undefined) updates.note = note;
    if (follow_up_date !== undefined) updates.follow_up_date = follow_up_date || null;
    if (created_at !== undefined) updates.created_at = created_at || followUp.created_at;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), followUpId];
    await db.query(`UPDATE lead_follow_ups SET ${setClauses} WHERE id = ?`, values);

    const [updated] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.id = ?`,
      [followUpId]
    );

    return res.json(updated[0]);
  } catch (err) {
    console.error('Follow-up update error:', err);
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
