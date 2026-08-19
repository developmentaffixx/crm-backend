const db = require('../config/db');

/**
 * GET /api/leads/:id/qualification-score
 * Fetch qualification score for a lead
 */
exports.getScore = async (req, res) => {
  try {
    const leadId = req.params.id;

    const [rows] = await db.query(
      `SELECT qs.*, CONCAT(u.first_name, ' ', u.last_name) AS scored_by_name
       FROM lead_qualification_scores qs
       LEFT JOIN users u ON u.id = qs.scored_by
       WHERE qs.lead_id = ?`,
      [leadId]
    );

    if (rows.length === 0) {
      return res.json(null);
    }

    const row = rows[0];

    // Return in the shape frontend expects
    return res.json({
      id: row.id,
      lead_id: row.lead_id,
      scores: {
        industry_fit: row.industry_fit || 0,
        business_potential: row.business_potential || 0,
        marketing_need: row.marketing_need || 0,
        growth_potential: row.growth_potential || 0,
        budget_potential: row.budget_potential || 0,
        decision_maker_access: row.decision_maker_access || 0,
        timing_urgency: row.timing_urgency || 0,
        digital_gap: row.digital_gap || 0,
      },
      total_score: row.total_score || 0,
      priority: row.priority || null,
      scored_by: row.scored_by,
      scored_by_name: row.scored_by_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('Lead qualification score get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leads/:id/qualification-score
 * Create or update qualification score for a lead
 */
exports.saveScore = async (req, res) => {
  try {
    const leadId = req.params.id;
    const { scores, total, priority } = req.body;

    if (!scores) {
      return res.status(400).json({ message: 'Scores object is required' });
    }

    const {
      industry_fit = 0,
      business_potential = 0,
      marketing_need = 0,
      growth_potential = 0,
      budget_potential = 0,
      decision_maker_access = 0,
      timing_urgency = 0,
      digital_gap = 0,
    } = scores;

    // Calculate total and priority on server side for consistency
    const totalScore = (parseInt(industry_fit) || 0) +
      (parseInt(business_potential) || 0) +
      (parseInt(marketing_need) || 0) +
      (parseInt(growth_potential) || 0) +
      (parseInt(budget_potential) || 0) +
      (parseInt(decision_maker_access) || 0) +
      (parseInt(timing_urgency) || 0) +
      (parseInt(digital_gap) || 0);

    let computedPriority;
    if (totalScore >= 32) computedPriority = 'HOT';
    else if (totalScore >= 24) computedPriority = 'WARM';
    else if (totalScore >= 16) computedPriority = 'NURTURE';
    else computedPriority = 'LOW PRIORITY';

    // Check if record exists
    const [existing] = await db.query(
      'SELECT id FROM lead_qualification_scores WHERE lead_id = ?',
      [leadId]
    );

    const fields = {
      lead_id: leadId,
      industry_fit: parseInt(industry_fit) || 0,
      business_potential: parseInt(business_potential) || 0,
      marketing_need: parseInt(marketing_need) || 0,
      growth_potential: parseInt(growth_potential) || 0,
      budget_potential: parseInt(budget_potential) || 0,
      decision_maker_access: parseInt(decision_maker_access) || 0,
      timing_urgency: parseInt(timing_urgency) || 0,
      digital_gap: parseInt(digital_gap) || 0,
      total_score: totalScore,
      priority: computedPriority,
      scored_by: req.user.id,
    };

    if (existing.length > 0) {
      // Update
      const { lead_id, ...updateFields } = fields;
      const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updateFields);
      values.push(leadId);

      await db.query(
        `UPDATE lead_qualification_scores SET ${setClauses} WHERE lead_id = ?`,
        values
      );
    } else {
      // Insert
      const columns = Object.keys(fields).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const values = Object.values(fields);

      await db.query(
        `INSERT INTO lead_qualification_scores (${columns}) VALUES (${placeholders})`,
        values
      );
    }

    // Also update the lead's temperature field based on priority
    const tempMap = { 'HOT': 'hot', 'WARM': 'warm', 'NURTURE': 'cold', 'LOW PRIORITY': 'cold' };
    await db.query(
      'UPDATE leads SET temperature = ? WHERE id = ?',
      [tempMap[computedPriority], leadId]
    );

    // Return updated record
    const [rows] = await db.query(
      `SELECT qs.*, CONCAT(u.first_name, ' ', u.last_name) AS scored_by_name
       FROM lead_qualification_scores qs
       LEFT JOIN users u ON u.id = qs.scored_by
       WHERE qs.lead_id = ?`,
      [leadId]
    );

    const row = rows[0];
    return res.json({
      id: row.id,
      lead_id: row.lead_id,
      scores: {
        industry_fit: row.industry_fit || 0,
        business_potential: row.business_potential || 0,
        marketing_need: row.marketing_need || 0,
        growth_potential: row.growth_potential || 0,
        budget_potential: row.budget_potential || 0,
        decision_maker_access: row.decision_maker_access || 0,
        timing_urgency: row.timing_urgency || 0,
        digital_gap: row.digital_gap || 0,
      },
      total_score: row.total_score || 0,
      priority: row.priority || null,
      scored_by: row.scored_by,
      scored_by_name: row.scored_by_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('Lead qualification score save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
