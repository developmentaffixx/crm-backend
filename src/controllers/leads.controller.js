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
      `SELECT id, name, business_name, phone, address, city, state FROM leads WHERE ${where} ORDER BY business_name ASC, name ASC`,
      params
    );

    return res.json({ leads: rows });
  } catch (err) {
    console.error('Leads dropdown error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
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
    const { temperature, source, status, search, industry, assigned_to, date_from, date_to, lead_stage, page = 1, limit = 50, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    let where = 'l.deleted = 0';
    const params = [];

    if (temperature) { where += ' AND l.temperature = ?'; params.push(temperature); }
    if (source)      { where += ' AND l.source = ?';      params.push(source); }
    if (status)      { where += ' AND l.status = ?';      params.push(status); }
    if (industry)    { where += ' AND l.industry = ?';    params.push(industry); }
    if (lead_stage)  { where += ' AND l.lead_stage = ?';  params.push(lead_stage); }
    if (assigned_to) { where += ' AND l.assigned_to = ?'; params.push(assigned_to); }
    if (date_from)   { where += ' AND DATE(l.created_at) >= ?'; params.push(date_from); }
    if (date_to)     { where += ' AND DATE(l.created_at) <= ?'; params.push(date_to); }
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
    return res.status(500).json({ message: err.message || 'Server error' });
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
    return res.status(500).json({ message: err.message || 'Server error' });
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
    lead_stage, lead_score, expected_revenue, next_action, interested_services, brand_year
  } = req.body;

  try {
    // Generate lead_id (race-condition safe) — uses custom date if provided
    const lead_id = await generateLeadId(null, created_at || null);

    const [result] = await db.query(
      `INSERT INTO leads (lead_id, name, business_name, brand_year, industry, service_required, budget_min, budget_max, no_budget_idea,
        purpose_of_services, phone, email, address, country, state, city, zip_code,
        temperature, source, resource, status, current_marketing_status, assigned_to, created_by, created_at,
        lead_stage, lead_score, expected_revenue, next_action, interested_services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        name, business_name || null, brand_year || null, industry || null, service_required || null,
        no_budget_idea ? null : (budget_min || null),
        no_budget_idea ? null : (budget_max || null),
        no_budget_idea ? 1 : 0,
        purpose_of_services || null, phone || null, email || null,
        address || null, country || null, state || null, city || null, zip_code || null,
        temperature || 'cold', source || null, resource || null, status || 'New',
        current_marketing_status || null, assigned_to || null, req.user.id,
        created_at ? new Date(created_at) : new Date(),
        lead_stage || 'New', lead_score || 1, expected_revenue || null,
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
    return res.status(500).json({ message: err.message || 'Server error' });
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
    // Fix 3: Allow admin, creator, or assigned person to edit
    // Using == (loose) to handle int vs string type mismatch from JWT token
    if (!req.user.is_admin && lead.created_by != req.user.id && lead.assigned_to != req.user.id) {
      return res.status(403).json({ message: 'Only the creator, assigned person, or admin can edit this lead' });
    }

    const allowed = [
      'name', 'business_name', 'brand_year', 'industry', 'service_required', 'budget_min', 'budget_max', 'no_budget_idea',
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

    // Fix 1 & 4: created_at and lead_id are read-only after creation — ignore any incoming value
    // (removing the old date-change / lead_id regeneration block that was causing the 500 crash)

    // Fix 2: no_budget_idea must be strictly checked (string "0" is truthy in JS)
    if (updates.no_budget_idea == 1) {
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
      const linksArr = Array.isArray(req.body.social_links) ? req.body.social_links : [];
      const links = linksArr.filter(sl => sl.platform && sl.url);
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
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * PATCH /api/leads/:id/status — Quick stage change (updates lead_stage as the single pipeline field)
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body; // 'status' param name kept for API backward compat
    if (!status) return res.status(400).json({ message: 'Stage is required' });

    const validStages = ['New', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Meeting', 'Proposal', 'Negotiation', 'Won', 'Lost'];
    if (!validStages.includes(status)) {
      return res.status(400).json({ message: 'Invalid stage value' });
    }

    const [rows] = await db.query('SELECT * FROM leads WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Lead not found' });

    const lead = rows[0];
    if (!req.user.is_admin && lead.created_by !== req.user.id && lead.assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (lead.lead_stage === status) {
      return res.json({ message: 'Stage unchanged', lead });
    }

    // Record status change history
    await db.query(
      'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
      [req.params.id, lead.lead_stage || lead.status, status, req.user.id]
    );

    // Auto-derive temperature and score from new stage
    const stageTemperature = { 'New': 'cold', 'Contacted': 'cold', 'Replied': 'cold', 'Interested': 'warm', 'Qualified': 'warm', 'Meeting': 'hot', 'Proposal': 'hot', 'Negotiation': 'hot', 'Won': 'hot', 'Lost': 'cold' };
    const stageScore = { 'New': 1, 'Contacted': 1, 'Replied': 2, 'Interested': 3, 'Qualified': 3, 'Meeting': 4, 'Proposal': 4, 'Negotiation': 4, 'Won': 5, 'Lost': 1 };
    const temperature = stageTemperature[status] || 'cold';
    const lead_score = stageScore[status] || 1;

    // If stage is being set to 'Won', generate client_code (same as convert endpoint)
    if (status === 'Won' && !lead.client_code) {
      const client_code = await generateClientCode();
      await db.query('UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ?, client_code = ?, converted_at = NOW() WHERE id = ?', [status, status, temperature, lead_score, client_code, req.params.id]);
    } else {
      await db.query('UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ? WHERE id = ?', [status, status, temperature, lead_score, req.params.id]);
    }

    const [updated] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Lead updateStatus error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
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
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─── Helper: Auto-derive lead_stage, lead_score, and temperature from follow-up outcome ─────
function deriveStageAndScore(outcome) {
  const map = {
    // Contact Outcomes
    'No Response':                  { stage: 'Contacted',    score: 1, temperature: 'cold' },
    'Callback Requested':           { stage: 'Contacted',    score: 2, temperature: 'cold' },
    'Shared Details':               { stage: 'Replied',      score: 2, temperature: 'cold' },
    // Interest Outcomes
    'Interested':                   { stage: 'Interested',   score: 3, temperature: 'warm' },
    'Not Interested':               { stage: 'Lost',         score: 1, temperature: 'cold' },
    // Qualification Outcomes
    'Budget Issue':                 { stage: 'Negotiation',  score: 3, temperature: 'warm' },
    'Timing Issue':                 { stage: 'Negotiation',  score: 3, temperature: 'warm' },
    'Already Working With Agency':  { stage: 'Lost',         score: 1, temperature: 'cold' },
    // Sales Outcomes
    'Meeting Scheduled':            { stage: 'Meeting',      score: 4, temperature: 'hot' },
    'Proposal Requested':           { stage: 'Proposal',     score: 4, temperature: 'hot' },
    'Negotiation Stage':            { stage: 'Negotiation',  score: 4, temperature: 'hot' },
    // Final Outcomes
    'Converted':                    { stage: 'Won',          score: 5, temperature: 'hot' },
    'Lost':                         { stage: 'Lost',         score: 1, temperature: 'cold' },
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

    // Validation: outcome and follow_up_date are required alongside note
    if (!outcome || !outcome.trim()) {
      return res.status(400).json({ message: 'Outcome is required' });
    }
    if (!follow_up_date) {
      return res.status(400).json({ message: 'Next follow-up date is required' });
    }

    const [result] = await db.query(
      'INSERT INTO lead_follow_ups (lead_id, type, outcome, note, follow_up_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, type || 'Phone Call', outcome || null, note, follow_up_date || null, req.user.id, created_at || new Date()]
    );

    // Auto-update lead stage, score & temperature from outcome, unless manually overridden
    const auto = outcome ? deriveStageAndScore(outcome) : null;
    const leadUpdates = {};

    if (lead_stage) {
      leadUpdates.lead_stage = lead_stage; // manual override takes priority
    } else if (auto?.stage) {
      // Only auto-advance — never go backwards (except to Lost/Won)
      const stageOrder = ['New','Contacted','Replied','Interested','Qualified','Meeting','Proposal','Negotiation','Won','Lost'];
      const [currentLead] = await db.query('SELECT lead_stage, lead_score, temperature FROM leads WHERE id = ?', [req.params.id]);
      const currentStageIdx = stageOrder.indexOf(currentLead[0]?.lead_stage || 'New');
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
      if (outcome === 'Not Interested' || outcome === 'Already Working With Agency' || outcome === 'Lost') {
        leadUpdates.lead_score = 1; // reset on loss
      } else if (auto.score > currentScore) {
        leadUpdates.lead_score = auto.score;
      }
    }

    // Auto-update temperature based on outcome
    if (auto?.temperature) {
      leadUpdates.temperature = auto.temperature;
    }

    if (next_action) leadUpdates.next_action = next_action;
    else if (auto?.stage) {
      // Auto-suggest next action based on stage
      const nextActionMap = {
        'Contacted':    'Follow-Up Call',
        'Replied':      'Follow-Up Call',
        'Interested':   'Schedule Meeting',
        'Qualified':    'Send Proposal',
        'Meeting':      'Send Proposal',
        'Proposal':     'Waiting for Client',
        'Negotiation':  'Send Pricing',
        'Won':          null,
        'Lost':         null,
      };
      const suggested = nextActionMap[leadUpdates.lead_stage || auto.stage];
      if (suggested) leadUpdates.next_action = suggested;
    }

    // Keep status field in sync with lead_stage (single source of truth)
    if (leadUpdates.lead_stage) {
      leadUpdates.status = leadUpdates.lead_stage;
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
    return res.status(500).json({ message: err.message || 'Server error' });
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
    return res.status(500).json({ message: err.message || 'Server error' });
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
    return res.status(500).json({ message: err.message || 'Server error' });
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
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─── Helper: Generate Client Code (AFXCL###) ─────────────────────────────────
async function generateClientCode() {
  const [rows] = await db.query(
    `SELECT MAX(CAST(SUBSTRING(client_code, 6) AS UNSIGNED)) AS max_seq FROM leads WHERE client_code IS NOT NULL AND client_code LIKE 'AFXCL%'`
  );
  const seq = String((rows[0]?.max_seq || 0) + 1).padStart(3, '0');
  return `AFXCL${seq}`;
}

/**
 * GET /api/leads/follow-ups/custom-options
 * Returns distinct custom types and outcomes used across all follow-ups
 */
exports.getFollowUpCustomOptions = async (req, res) => {
  try {
    const defaultTypes = ['Phone Call', 'Email', 'WhatsApp', 'Meeting', 'Instagram', 'LinkedIn', 'Proposal Discussion', 'Payment Follow-Up', 'Other', 'Initial Follow-up'];
    const defaultOutcomes = ['No Response', 'Callback Requested', 'Shared Details', 'Interested', 'Not Interested', 'Budget Issue', 'Timing Issue', 'Already Working With Agency', 'Meeting Scheduled', 'Proposal Requested', 'Negotiation Stage', 'Converted', 'Lost'];

    const [types] = await db.query(
      `SELECT DISTINCT type FROM lead_follow_ups WHERE type IS NOT NULL AND type != ''`
    );
    const [outcomes] = await db.query(
      `SELECT DISTINCT outcome FROM lead_follow_ups WHERE outcome IS NOT NULL AND outcome != ''`
    );

    const customTypes = types.map(r => r.type).filter(t => !defaultTypes.includes(t));
    const customOutcomes = outcomes.map(r => r.outcome).filter(o => !defaultOutcomes.includes(o));

    return res.json({ customTypes, customOutcomes });
  } catch (err) {
    console.error('Custom options error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

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
    if (lead.lead_stage === 'Won' || lead.status === 'Won') {
      return res.status(400).json({ message: 'Lead is already converted to client' });
    }

    // Generate client code
    const client_code = await generateClientCode();

    // Record status change
    await db.query(
      'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
      [req.params.id, lead.lead_stage || lead.status, 'Won', req.user.id]
    );

    await db.query("UPDATE leads SET status = 'Won', lead_stage = 'Won', lead_score = 5, temperature = 'hot', client_code = ?, converted_at = NOW() WHERE id = ?", [client_code, req.params.id]);

    const [updated] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.emitSocket('leads:updated', updated[0]);
    return res.json({ message: 'Lead converted to client successfully', lead: updated[0] });
  } catch (err) {
    console.error('Lead convert error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * PATCH /api/leads/bulk-reassign
 * Bulk reassign leads to a different user
 * Body: { lead_ids: [1,2,3], assigned_to: 5 }
 * - lead_ids: array of lead IDs to reassign (if empty/missing, reassigns ALL unassigned)
 * - assigned_to: user ID to assign leads to
 */
exports.bulkReassign = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin can bulk reassign leads' });
    }

    const { lead_ids, assigned_to } = req.body;

    if (!assigned_to) {
      return res.status(400).json({ message: 'assigned_to (user ID) is required' });
    }

    // Verify the target user exists
    const [targetUser] = await db.query(
      'SELECT id, first_name, last_name, emp_code FROM users WHERE id = ? AND deleted = 0',
      [assigned_to]
    );
    if (targetUser.length === 0) {
      return res.status(404).json({ message: 'Target user not found' });
    }

    let result;
    if (lead_ids && lead_ids.length > 0) {
      // Reassign specific leads
      const placeholders = lead_ids.map(() => '?').join(',');
      [result] = await db.query(
        `UPDATE leads SET assigned_to = ?, updated_at = NOW() WHERE id IN (${placeholders}) AND deleted = 0`,
        [assigned_to, ...lead_ids]
      );
    } else {
      // Reassign all unassigned leads
      [result] = await db.query(
        'UPDATE leads SET assigned_to = ?, updated_at = NOW() WHERE assigned_to IS NULL AND deleted = 0',
        [assigned_to]
      );
    }

    return res.json({
      message: `${result.affectedRows} lead(s) reassigned to ${targetUser[0].first_name} ${targetUser[0].last_name}`,
      count: result.affectedRows,
      assigned_to: targetUser[0],
    });
  } catch (err) {
    console.error('Bulk reassign error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * GET /api/leads/filter-options
 * Returns distinct values for filter dropdowns (source, industry, status, assigned users)
 */
exports.getFilterOptions = async (req, res) => {
  try {
    // Predefined options (always shown regardless of DB data)
    const predefinedStatuses = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Converted', 'Lost'];
    const predefinedSources = ['Google', 'Facebook', 'Instagram', 'LinkedIn', 'Referral', 'Cold Call', 'Website', 'WhatsApp', 'Event', 'Other'];
    const predefinedStages = ['New', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Meeting', 'Proposal', 'Negotiation', 'Won', 'Lost'];

    // Get additional values from DB that may not be in predefined lists
    const [dbSources] = await db.query(
      "SELECT DISTINCT source FROM leads WHERE deleted = 0 AND source IS NOT NULL AND source != '' ORDER BY source"
    );
    const [dbStatuses] = await db.query(
      "SELECT DISTINCT status FROM leads WHERE deleted = 0 AND status IS NOT NULL ORDER BY status"
    );
    const [industries] = await db.query(
      "SELECT DISTINCT industry FROM leads WHERE deleted = 0 AND industry IS NOT NULL AND industry != '' ORDER BY industry"
    );
    const [dbStages] = await db.query(
      "SELECT DISTINCT lead_stage FROM leads WHERE deleted = 0 AND lead_stage IS NOT NULL AND lead_stage != '' ORDER BY lead_stage"
    );
    const [users] = await db.query(
      "SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE deleted = 0 AND is_active = 1 ORDER BY first_name"
    );

    // Merge predefined + any extra from DB
    const allSources = [...new Set([...predefinedSources, ...dbSources.map(r => r.source)])];
    const allStatuses = [...new Set([...predefinedStatuses, ...dbStatuses.map(r => r.status)])];
    const allStages = [...new Set([...predefinedStages, ...dbStages.map(r => r.lead_stage)])];

    return res.json({
      sources: allSources,
      industries: industries.map(r => r.industry),
      statuses: allStatuses,
      stages: allStages,
      users: users,
    });
  } catch (err) {
    console.error('Lead filter options error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};
