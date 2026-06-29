const db = require('../config/db');

/**
 * GET /api/leads/:id/qualification
 * Fetch qualification checklist for a lead
 */
exports.getQualification = async (req, res) => {
  try {
    const leadId = req.params.id;

    const [rows] = await db.query(
      `SELECT q.*, CONCAT(u.first_name, ' ', u.last_name) AS filled_by_name
       FROM lead_qualifications q
       LEFT JOIN users u ON u.id = q.filled_by
       WHERE q.lead_id = ?`,
      [leadId]
    );

    if (rows.length === 0) {
      return res.json(null);
    }

    const row = rows[0];
    // Parse JSON field
    if (row.website_condition && typeof row.website_condition === 'string') {
      try { row.website_condition = JSON.parse(row.website_condition); } catch (e) { row.website_condition = []; }
    }

    return res.json(row);
  } catch (err) {
    console.error('Lead qualification get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leads/:id/qualification
 * Create or update qualification checklist for a lead
 */
exports.saveQualification = async (req, res) => {
  try {
    const leadId = req.params.id;
    const {
      website_status, website_condition, website_remarks,
      instagram_followers, facebook_available, posting_consistency, content_quality, social_media_remarks,
      google_profile_status, google_reviews, google_average_rating, google_profile_remarks,
      decision_maker_identified, decision_maker_name, decision_maker_designation, authority_level,
      budget_potential, investment_readiness, budget_remarks,
      recommend_pursuing, assessment_reason,
    } = req.body;

    // Check if record exists
    const [existing] = await db.query(
      'SELECT id FROM lead_qualifications WHERE lead_id = ?',
      [leadId]
    );

    const websiteConditionJson = website_condition ? JSON.stringify(website_condition) : null;

    const fields = {
      lead_id: leadId,
      website_status: website_status || null,
      website_condition: websiteConditionJson,
      website_remarks: website_remarks || null,
      instagram_followers: instagram_followers || null,
      facebook_available: facebook_available || null,
      posting_consistency: posting_consistency || null,
      content_quality: content_quality || null,
      social_media_remarks: social_media_remarks || null,
      google_profile_status: google_profile_status || null,
      google_reviews: google_reviews || null,
      google_average_rating: google_average_rating || null,
      google_profile_remarks: google_profile_remarks || null,
      decision_maker_identified: decision_maker_identified || null,
      decision_maker_name: decision_maker_name || null,
      decision_maker_designation: decision_maker_designation || null,
      authority_level: authority_level || null,
      budget_potential: budget_potential || null,
      investment_readiness: investment_readiness || null,
      budget_remarks: budget_remarks || null,
      recommend_pursuing: recommend_pursuing || null,
      assessment_reason: assessment_reason || null,
      filled_by: req.user.id,
    };

    if (existing.length > 0) {
      // Update
      const { lead_id, ...updateFields } = fields;
      const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updateFields);
      values.push(leadId);

      await db.query(
        `UPDATE lead_qualifications SET ${setClauses} WHERE lead_id = ?`,
        values
      );
    } else {
      // Insert
      const columns = Object.keys(fields).join(', ');
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const values = Object.values(fields);

      await db.query(
        `INSERT INTO lead_qualifications (${columns}) VALUES (${placeholders})`,
        values
      );
    }

    // Return updated record
    const [rows] = await db.query(
      `SELECT q.*, CONCAT(u.first_name, ' ', u.last_name) AS filled_by_name
       FROM lead_qualifications q
       LEFT JOIN users u ON u.id = q.filled_by
       WHERE q.lead_id = ?`,
      [leadId]
    );

    const row = rows[0];
    if (row.website_condition && typeof row.website_condition === 'string') {
      try { row.website_condition = JSON.parse(row.website_condition); } catch (e) { row.website_condition = []; }
    }

    return res.json(row);
  } catch (err) {
    console.error('Lead qualification save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
