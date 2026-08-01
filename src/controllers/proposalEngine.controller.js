const db = require('../config/db');
const crypto = require('crypto');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function computeExpiry(days) {
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + parseInt(days));
  return d;
}

function parseJsonFields(row, fields) {
  fields.forEach(f => {
    if (row[f] && typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch (_) {}
    }
  });
  return row;
}

const PROPOSAL_JSON_FIELDS = ['social_links', 'pain_points', 'opportunities', 'case_study_ids', 'generated_content'];

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES, INDUSTRIES, PERSONAS, CASE STUDIES — Read-only for proposal wizard
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/proposal-engine/templates
 * List all service templates
 */
exports.getTemplates = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposal_service_templates ORDER BY id ASC');
    rows.forEach(r => parseJsonFields(r, ['sections']));
    return res.json({ templates: rows });
  } catch (err) {
    console.error('getTemplates error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/proposal-engine/industries
 * List all industry blocks (optionally filter by service_key)
 */
exports.getIndustries = async (req, res) => {
  try {
    const { service_key } = req.query;
    let sql = 'SELECT * FROM proposal_industry_blocks';
    const params = [];
    if (service_key) {
      sql += ' WHERE service_key = ?';
      params.push(service_key);
    }
    sql += ' ORDER BY industry_name ASC';
    const [rows] = await db.query(sql, params);
    rows.forEach(r => parseJsonFields(r, ['challenges', 'opportunities', 'expected_outcomes', 'case_study_ids']));
    return res.json({ industries: rows });
  } catch (err) {
    console.error('getIndustries error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/proposal-engine/personas
 * List all persona blocks
 */
exports.getPersonas = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposal_persona_blocks ORDER BY persona_name ASC');
    rows.forEach(r => parseJsonFields(r, ['expected_outcomes']));
    return res.json({ personas: rows });
  } catch (err) {
    console.error('getPersonas error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/proposal-engine/case-studies
 * List all active case studies (optionally filter by industry_key / service_key)
 */
exports.getCaseStudies = async (req, res) => {
  try {
    const { industry_key, service_key } = req.query;
    let sql = 'SELECT * FROM proposal_case_studies WHERE is_active = 1';
    const params = [];
    if (industry_key) { sql += ' AND industry_key = ?'; params.push(industry_key); }
    if (service_key) { sql += ' AND service_key = ?'; params.push(service_key); }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await db.query(sql, params);
    rows.forEach(r => parseJsonFields(r, ['metrics']));
    return res.json({ caseStudies: rows });
  } catch (err) {
    console.error('getCaseStudies error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CASE STUDY CRUD (Admin)
// ═══════════════════════════════════════════════════════════════════════════════

exports.createCaseStudy = async (req, res) => {
  const { title, client_name, industry_key, service_key, situation, what_we_did, results, metrics, image_url } = req.body;
  if (!title || !client_name) return res.status(400).json({ message: 'Title and client name are required' });

  try {
    const [result] = await db.query(
      `INSERT INTO proposal_case_studies (title, client_name, industry_key, service_key, situation, what_we_did, results, metrics, image_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, client_name, industry_key || null, service_key || null, situation || null, what_we_did || null, results || null, metrics ? JSON.stringify(metrics) : null, image_url || null, req.user.id]
    );
    const [rows] = await db.query('SELECT * FROM proposal_case_studies WHERE id = ?', [result.insertId]);
    parseJsonFields(rows[0], ['metrics']);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createCaseStudy error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.updateCaseStudy = async (req, res) => {
  const { title, client_name, industry_key, service_key, situation, what_we_did, results, metrics, image_url, is_active } = req.body;
  try {
    await db.query(
      `UPDATE proposal_case_studies SET title=?, client_name=?, industry_key=?, service_key=?, situation=?, what_we_did=?, results=?, metrics=?, image_url=?, is_active=? WHERE id=?`,
      [title, client_name, industry_key || null, service_key || null, situation || null, what_we_did || null, results || null, metrics ? JSON.stringify(metrics) : null, image_url || null, is_active !== undefined ? is_active : 1, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM proposal_case_studies WHERE id = ?', [req.params.id]);
    parseJsonFields(rows[0], ['metrics']);
    return res.json(rows[0]);
  } catch (err) {
    console.error('updateCaseStudy error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteCaseStudy = async (req, res) => {
  try {
    await db.query('UPDATE proposal_case_studies SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('deleteCaseStudy error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROPOSAL CRUD (Authenticated)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/proposal-engine/proposals
 */
exports.list = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND p.created_by = ?';
      params.push(req.user.id);
    }
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (p.client_name LIKE ? OR p.business_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

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
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM proposals p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    rows.forEach(r => parseJsonFields(r, PROPOSAL_JSON_FIELDS));

    return res.json({
      proposals: rows,
      summary: summaryRows[0],
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('Proposal engine list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/proposal-engine/proposals
 * Create a new proposal (from wizard)
 */
exports.create = async (req, res) => {
  const {
    lead_id, client_id, service_key, industry_key, persona_key,
    client_name, business_name, contact_person, designation, phone, email, website, social_links,
    current_situation, pain_points, opportunities, goals, special_notes,
    website_type, existing_issues, recommended_improvements,
    pricing_package, service_cost, ad_spend, additional_cost, one_time_cost, monthly_cost, pricing_notes,
    case_study_ids, selected_plan_service_id, validity_days,
    prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website
  } = req.body;

  if (!service_key || !industry_key || !client_name) {
    return res.status(400).json({ message: 'Service, industry, and client name are required' });
  }

  try {
    const token = generateToken();
    const vDays = validity_days || 7;
    const expiresAt = computeExpiry(vDays);

    // Calculate totals
    const sCost = parseFloat(service_cost) || 0;
    const aSpend = parseFloat(ad_spend) || 0;
    const addCost = parseFloat(additional_cost) || 0;
    const otCost = parseFloat(one_time_cost) || 0;
    const mCost = parseFloat(monthly_cost) || 0;
    const totalMonthly = mCost || (sCost + aSpend + addCost);
    const totalFirstMonth = totalMonthly + otCost;

    // Generate content from template + industry block + persona
    const generatedContent = await assembleProposalContent({
      service_key, industry_key, persona_key,
      client_name, business_name, current_situation, pain_points, opportunities, goals, special_notes,
      website_type, existing_issues, recommended_improvements, case_study_ids,
      service_cost: sCost, ad_spend: aSpend, additional_cost: addCost,
      one_time_cost: otCost, monthly_cost: mCost, total_monthly: totalMonthly, total_first_month: totalFirstMonth,
    });

    const [result] = await db.query(
      `INSERT INTO proposals (
        proposal_token, lead_id, client_id, service_key, industry_key, persona_key,
        client_name, business_name, contact_person, designation, phone, email, website, social_links,
        current_situation, pain_points, opportunities, goals, special_notes,
        website_type, existing_issues, recommended_improvements,
        pricing_package, service_cost, ad_spend, additional_cost, one_time_cost, monthly_cost,
        total_monthly, total_first_month, pricing_notes,
        case_study_ids, selected_plan_service_id, generated_content,
        validity_days, expires_at, prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website,
        status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        token, lead_id || null, client_id || null, service_key, industry_key, persona_key || null,
        client_name, business_name || null, contact_person || null, designation || null,
        phone || null, email || null, website || null,
        social_links ? JSON.stringify(social_links) : null,
        current_situation || null,
        pain_points ? JSON.stringify(pain_points) : null,
        opportunities ? JSON.stringify(opportunities) : null,
        goals || null, special_notes || null,
        website_type || null, existing_issues || null, recommended_improvements || null,
        pricing_package || 'custom', sCost, aSpend, addCost, otCost, mCost, totalMonthly, totalFirstMonth,
        pricing_notes || null,
        case_study_ids ? JSON.stringify(case_study_ids) : null,
        selected_plan_service_id || null,
        JSON.stringify(generatedContent),
        vDays, expiresAt,
        prepared_by_name || null, prepared_by_email || null, prepared_by_phone || null, prepared_by_website || null,
        req.user.id,
      ]
    );

    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ?', [result.insertId]);
    const proposal = parseJsonFields(rows[0], PROPOSAL_JSON_FIELDS);
    res.emitSocket('proposal-engine:created', proposal);
    return res.status(201).json(proposal);
  } catch (err) {
    console.error('Proposal engine create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/proposal-engine/proposals/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM proposals p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ? AND p.deleted = 0`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = parseJsonFields(rows[0], PROPOSAL_JSON_FIELDS);
    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    return res.json(proposal);
  } catch (err) {
    console.error('Proposal engine getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/proposal-engine/proposals/:id
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const fields = [
      'lead_id', 'client_id', 'service_key', 'industry_key', 'persona_key',
      'client_name', 'business_name', 'contact_person', 'designation', 'phone', 'email', 'website',
      'current_situation', 'goals', 'special_notes',
      'website_type', 'existing_issues', 'recommended_improvements',
      'pricing_package', 'service_cost', 'ad_spend', 'additional_cost', 'one_time_cost', 'monthly_cost',
      'pricing_notes', 'selected_plan_service_id', 'validity_days', 'status',
      'prepared_by_name', 'prepared_by_email', 'prepared_by_phone', 'prepared_by_website'
    ];
    const jsonFieldsToUpdate = ['social_links', 'pain_points', 'opportunities', 'case_study_ids', 'generated_content'];

    const updates = {};
    fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    jsonFieldsToUpdate.forEach(f => { if (req.body[f] !== undefined) updates[f] = JSON.stringify(req.body[f]); });

    // Recalculate totals if pricing fields changed
    if (req.body.service_cost !== undefined || req.body.ad_spend !== undefined || req.body.additional_cost !== undefined || req.body.monthly_cost !== undefined || req.body.one_time_cost !== undefined) {
      const sCost = parseFloat(req.body.service_cost ?? rows[0].service_cost) || 0;
      const aSpend = parseFloat(req.body.ad_spend ?? rows[0].ad_spend) || 0;
      const addCost = parseFloat(req.body.additional_cost ?? rows[0].additional_cost) || 0;
      const otCost = parseFloat(req.body.one_time_cost ?? rows[0].one_time_cost) || 0;
      const mCost = parseFloat(req.body.monthly_cost ?? rows[0].monthly_cost) || 0;
      updates.total_monthly = mCost || (sCost + aSpend + addCost);
      updates.total_first_month = updates.total_monthly + otCost;
    }

    if (updates.validity_days) updates.expires_at = computeExpiry(updates.validity_days);

    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No fields to update' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE proposals SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    const proposal = parseJsonFields(updated[0], PROPOSAL_JSON_FIELDS);
    res.emitSocket('proposal-engine:updated', proposal);
    return res.json(proposal);
  } catch (err) {
    console.error('Proposal engine update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/proposal-engine/proposals/:id (soft delete)
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    await db.query('UPDATE proposals SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('proposal-engine:deleted', { id: parseInt(req.params.id) });
    return res.json({ message: 'Proposal deleted' });
  } catch (err) {
    console.error('Proposal engine remove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/proposal-engine/proposals/:id/mark-sent
 */
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
    res.emitSocket('proposal-engine:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('markSent error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/proposal-engine/proposals/:id/regenerate
 * Regenerate proposal content (after editing inputs)
 */
exports.regenerate = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) return res.status(403).json({ message: 'Access denied' });

    const p = parseJsonFields(rows[0], PROPOSAL_JSON_FIELDS);

    const generatedContent = await assembleProposalContent({
      service_key: p.service_key, industry_key: p.industry_key, persona_key: p.persona_key,
      client_name: p.client_name, business_name: p.business_name,
      current_situation: p.current_situation, pain_points: p.pain_points, opportunities: p.opportunities,
      goals: p.goals, special_notes: p.special_notes,
      website_type: p.website_type, existing_issues: p.existing_issues,
      recommended_improvements: p.recommended_improvements, case_study_ids: p.case_study_ids,
      service_cost: p.service_cost, ad_spend: p.ad_spend, additional_cost: p.additional_cost,
      one_time_cost: p.one_time_cost, monthly_cost: p.monthly_cost,
      total_monthly: p.total_monthly, total_first_month: p.total_first_month,
    });

    await db.query('UPDATE proposals SET generated_content = ? WHERE id = ?', [JSON.stringify(generatedContent), req.params.id]);

    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    const result = parseJsonFields(updated[0], PROPOSAL_JSON_FIELDS);
    return res.json(result);
  } catch (err) {
    console.error('regenerate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/proposal-engine/proposals/:id/content
 * Update the generated_content sections (content editor)
 * Body: { sections: [...] }
 */
exports.updateContent = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { sections } = req.body;
    if (!Array.isArray(sections)) return res.status(400).json({ message: 'Sections array is required' });

    const generatedContent = { sections, generated_at: new Date().toISOString() };
    await db.query('UPDATE proposals SET generated_content = ? WHERE id = ?', [JSON.stringify(generatedContent), req.params.id]);

    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    const proposal = parseJsonFields(updated[0], PROPOSAL_JSON_FIELDS);
    return res.json(proposal);
  } catch (err) {
    console.error('updateContent error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/proposal-engine/proposals/:id/duplicate
 * Duplicate a proposal
 */
exports.duplicate = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });
    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const p = rows[0];
    const token = generateToken();
    const expiresAt = computeExpiry(p.validity_days || 7);

    const [result] = await db.query(
      `INSERT INTO proposals (
        proposal_token, lead_id, client_id, service_key, industry_key, persona_key,
        client_name, business_name, contact_person, designation, phone, email, website, social_links,
        current_situation, pain_points, opportunities, goals, special_notes,
        website_type, existing_issues, recommended_improvements,
        pricing_package, service_cost, ad_spend, additional_cost, one_time_cost, monthly_cost,
        total_monthly, total_first_month, pricing_notes,
        case_study_ids, selected_plan_service_id, generated_content,
        validity_days, expires_at, prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website,
        status, created_by
      ) SELECT ?, lead_id, client_id, service_key, industry_key, persona_key,
        CONCAT(client_name, ' (Copy)'), business_name, contact_person, designation, phone, email, website, social_links,
        current_situation, pain_points, opportunities, goals, special_notes,
        website_type, existing_issues, recommended_improvements,
        pricing_package, service_cost, ad_spend, additional_cost, one_time_cost, monthly_cost,
        total_monthly, total_first_month, pricing_notes,
        case_study_ids, selected_plan_service_id, generated_content,
        validity_days, ?, prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website,
        'draft', ?
      FROM proposals WHERE id = ?`,
      [token, expiresAt, req.user.id, req.params.id]
    );

    const [created] = await db.query('SELECT * FROM proposals WHERE id = ?', [result.insertId]);
    const proposal = parseJsonFields(created[0], PROPOSAL_JSON_FIELDS);
    res.emitSocket('proposal-engine:created', proposal);
    return res.status(201).json(proposal);
  } catch (err) {
    console.error('duplicate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC (No auth — client-facing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/proposal-engine/public/:token
 */
exports.getPublic = async (req, res) => {
  try {
    const { token } = req.params;
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM proposals p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.proposal_token = ? AND p.deleted = 0`, [token]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = parseJsonFields(rows[0], PROPOSAL_JSON_FIELDS);

    // Check expiry
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return res.status(410).json({
        message: 'This proposal has expired', expired: true,
        client_name: proposal.client_name, business_name: proposal.business_name,
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
      getIO().emit('proposal-engine:viewed', { id: proposal.id, view_count: (proposal.view_count || 0) + 1 });
    } catch (_) {}

    // Also fetch case studies if IDs are set
    let caseStudies = [];
    if (proposal.case_study_ids && proposal.case_study_ids.length > 0) {
      const [csRows] = await db.query('SELECT * FROM proposal_case_studies WHERE id IN (?) AND is_active = 1', [proposal.case_study_ids]);
      csRows.forEach(r => parseJsonFields(r, ['metrics']));
      caseStudies = csRows;
    }

    // Also fetch the plan comparison if selected_plan_service_id is set
    let planComparison = null;
    if (proposal.selected_plan_service_id) {
      const [svcRows] = await db.query('SELECT * FROM proposal_services WHERE id = ? AND deleted = 0', [proposal.selected_plan_service_id]);
      if (svcRows.length > 0) {
        const svc = svcRows[0];
        const [plans] = await db.query('SELECT * FROM proposal_service_plans WHERE service_id = ? ORDER BY sort_order ASC', [svc.id]);
        const [features] = await db.query('SELECT * FROM proposal_service_features WHERE service_id = ? ORDER BY sort_order ASC', [svc.id]);
        let values = [];
        if (features.length > 0) {
          const featureIds = features.map(f => f.id);
          const [valRows] = await db.query('SELECT * FROM proposal_plan_values WHERE feature_id IN (?)', [featureIds]);
          values = valRows;
        }
        planComparison = { service_name: svc.name, plans, features, values };
      }
    }

    const { deleted, created_by, ...publicData } = proposal;
    return res.json({ ...publicData, case_studies_data: caseStudies, plan_comparison: planComparison });
  } catch (err) {
    console.error('getPublic error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/proposal-engine/public/:token/respond
 */
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
      getIO().emit('proposal-engine:responded', { id: proposal.id, status: action, client_note });
    } catch (_) {}

    return res.json({ message: `Proposal ${action} successfully`, status: action });
  } catch (err) {
    console.error('respond error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT ASSEMBLY ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

async function assembleProposalContent(data) {
  const {
    service_key, industry_key, persona_key,
    client_name, business_name, current_situation, pain_points, opportunities, goals, special_notes,
    website_type, existing_issues, recommended_improvements, case_study_ids,
    service_cost, ad_spend, additional_cost, one_time_cost, monthly_cost, total_monthly, total_first_month,
  } = data;

  // Fetch template
  const [templates] = await db.query('SELECT * FROM proposal_service_templates WHERE service_key = ?', [service_key]);
  const template = templates.length > 0 ? parseJsonFields(templates[0], ['sections']) : null;

  // Fetch industry block
  const [industryBlocks] = await db.query('SELECT * FROM proposal_industry_blocks WHERE industry_key = ? AND service_key = ?', [industry_key, service_key]);
  const industry = industryBlocks.length > 0 ? parseJsonFields(industryBlocks[0], ['challenges', 'opportunities', 'expected_outcomes', 'case_study_ids']) : null;

  // Also try generic industry block if service-specific one not found
  let genericIndustry = null;
  if (!industry) {
    const [genRows] = await db.query('SELECT * FROM proposal_industry_blocks WHERE industry_key = ? AND service_key = "smm"', [industry_key]);
    genericIndustry = genRows.length > 0 ? parseJsonFields(genRows[0], ['challenges', 'opportunities', 'expected_outcomes', 'case_study_ids']) : null;
  }
  const industryData = industry || genericIndustry;

  // Fetch persona block (only for personal_branding)
  let persona = null;
  if (persona_key && service_key === 'personal_branding') {
    const [personaRows] = await db.query('SELECT * FROM proposal_persona_blocks WHERE persona_key = ?', [persona_key]);
    persona = personaRows.length > 0 ? parseJsonFields(personaRows[0], ['expected_outcomes']) : null;
  }

  // Fetch case studies
  let caseStudies = [];
  if (case_study_ids && case_study_ids.length > 0) {
    const [csRows] = await db.query('SELECT * FROM proposal_case_studies WHERE id IN (?) AND is_active = 1', [case_study_ids]);
    csRows.forEach(r => parseJsonFields(r, ['metrics']));
    caseStudies = csRows;
  }

  // Build generated content sections
  const sections = [];
  const templateSections = template ? template.sections : [];

  for (const sec of templateSections) {
    const built = { key: sec.key, title: sec.title, type: sec.type, content: null };

    // Parse default_content from template
    let defaultContent = sec.default_content;
    if (defaultContent && typeof defaultContent === 'string') {
      try { defaultContent = JSON.parse(defaultContent); } catch (_) {}
    }

    switch (sec.key) {
      case 'cover':
        built.content = { client_name, business_name, service_name: template.service_name };
        break;

      case 'executive_summary':
        built.content = industryData?.executive_summary || defaultContent || `This proposal outlines our comprehensive ${template.service_name} strategy for ${client_name}.`;
        if (persona && persona.positioning) built.content += '\n\n' + persona.positioning;
        break;

      case 'current_presence':
      case 'current_analysis':
      case 'current_situation':
        if (service_key === 'website_dev' && website_type === 'revamp' && existing_issues) {
          built.content = existing_issues;
        } else {
          built.content = current_situation || defaultContent || 'To be analyzed during onboarding.';
        }
        break;

      case 'challenges':
        built.content = [
          ...(industryData?.challenges || []),
          ...(pain_points || []),
        ];
        if (built.content.length === 0 && defaultContent) built.content = defaultContent;
        break;

      case 'opportunities':
      case 'objectives':
        built.content = [
          ...(industryData?.opportunities || []),
          ...(opportunities || []),
        ];
        if (built.content.length === 0 && defaultContent) built.content = defaultContent;
        break;

      case 'expected_outcomes':
      case 'expected_growth':
        built.content = industryData?.expected_outcomes || persona?.expected_outcomes || defaultContent || [];
        break;

      case 'case_studies':
        built.content = caseStudies.map(cs => ({
          title: cs.title,
          client_name: cs.client_name,
          situation: cs.situation,
          what_we_did: cs.what_we_did,
          results: cs.results,
          metrics: cs.metrics,
        }));
        break;

      case 'investment':
      case 'ad_budget':
        built.content = {
          service_cost, ad_spend, additional_cost, one_time_cost, monthly_cost,
          total_monthly, total_first_month,
        };
        break;

      case 'positioning':
        built.content = persona?.positioning || defaultContent || '';
        break;

      case 'audience':
      case 'target_audience':
        built.content = persona?.audience || defaultContent || '';
        break;

      case 'content_strategy':
        built.content = persona?.content_strategy || defaultContent || '';
        break;

      case 'next_steps':
        built.content = defaultContent || [
          'Accept this proposal',
          'Kickoff call scheduled within 24 hours',
          'Strategy document shared within 3 days',
          'Execution begins within 7 days',
        ];
        break;

      default:
        // Use template default_content for all other sections (strategy, deliverables, timeline, etc.)
        built.content = defaultContent || special_notes || null;
        break;
    }

    sections.push(built);
  }

  return { sections, generated_at: new Date().toISOString() };
}
