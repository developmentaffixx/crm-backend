const db = require('../config/db');

/**
 * GET /api/sales-plan
 * Returns all sales plan sections. Accessible to all authenticated users.
 * Non-admin users only see sections where visible_to_users = 1.
 */
async function getAll(req, res) {
  try {
    const isAdmin = req.user && req.user.is_admin;

    let query = 'SELECT section, data, updated_at, visible_to_users FROM sales_plan ORDER BY id';
    // Non-admin users only get visible sections
    if (!isAdmin) {
      query = 'SELECT section, data, updated_at, visible_to_users FROM sales_plan WHERE visible_to_users = 1 ORDER BY id';
    }

    const [rows] = await db.query(query);

    // Convert rows to an object keyed by section
    const plan = {};
    for (const row of rows) {
      plan[row.section] = {
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        updated_at: row.updated_at,
        visible_to_users: row.visible_to_users === 1,
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

/**
 * PATCH /api/sales-plan/:section/visibility
 * Toggle visibility for a section. Admin only.
 */
async function toggleVisibility(req, res) {
  try {
    const { section } = req.params;
    const { visible } = req.body;

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

    if (typeof visible !== 'boolean') {
      return res.status(400).json({ message: 'visible must be a boolean' });
    }

    await db.query(
      'UPDATE sales_plan SET visible_to_users = ? WHERE section = ?',
      [visible ? 1 : 0, section]
    );

    res.json({ message: `Section ${visible ? 'shown to' : 'hidden from'} users`, visible });
  } catch (err) {
    console.error('salesPlan.toggleVisibility error:', err);
    res.status(500).json({ message: 'Failed to update visibility' });
  }
}

module.exports = { getAll, updateSection, toggleVisibility };
