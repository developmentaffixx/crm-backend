const db = require('../config/db');

/**
 * GET /api/sales-plan
 * Returns all sales plan sections. Accessible to all authenticated users.
 */
async function getAll(req, res) {
  try {
    const [rows] = await db.query(
      'SELECT section, data, updated_at FROM sales_plan ORDER BY id'
    );

    // Convert rows to an object keyed by section
    const plan = {};
    for (const row of rows) {
      plan[row.section] = {
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        updated_at: row.updated_at,
      };
    }

    res.json(plan);
  } catch (err) {
    console.error('salesPlan.getAll error:', err);
    res.status(500).json({ message: 'Failed to fetch sales plan' });
  }
}

/**
 * PUT /api/sales-plan/:section
 * Update a specific section. Admin only.
 */
async function updateSection(req, res) {
  try {
    const { section } = req.params;
    const { data } = req.body;

    const validSections = [
      'monthly_target',
      'daily_target',
      'outreach_breakdown',
      'call_breakdown',
      'industry_focus_day',
      'industry_daywise_split',
      'weekly_industry_target',
      'weekly_kpi_target',
    ];

    if (!validSections.includes(section)) {
      return res.status(400).json({ message: 'Invalid section' });
    }

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ message: 'Data must be a JSON array' });
    }

    await db.query(
      `INSERT INTO sales_plan (section, data, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by)`,
      [section, JSON.stringify(data), req.user.id]
    );

    res.json({ message: 'Section updated successfully' });
  } catch (err) {
    console.error('salesPlan.updateSection error:', err);
    res.status(500).json({ message: 'Failed to update section' });
  }
}

module.exports = { getAll, updateSection };
