const db = require('../config/db');

/**
 * GET /api/leads/:id/swot
 * Fetch all SWOT points for a lead
 */
exports.getSwot = async (req, res) => {
  try {
    const leadId = req.params.id;

    const [rows] = await db.query(
      `SELECT s.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_swot s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.lead_id = ?
       ORDER BY s.category ASC, s.created_at ASC`,
      [leadId]
    );

    // Group by category
    const swot = {
      strength: rows.filter(r => r.category === 'strength'),
      weakness: rows.filter(r => r.category === 'weakness'),
      opportunity: rows.filter(r => r.category === 'opportunity'),
    };

    return res.json(swot);
  } catch (err) {
    console.error('Lead SWOT get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/leads/:id/swot
 * Add a SWOT point
 * Body: { category: 'strength'|'weakness'|'opportunity', point: string }
 */
exports.addSwotPoint = async (req, res) => {
  try {
    const leadId = req.params.id;
    const { category, point } = req.body;

    if (!category || !point || !point.trim()) {
      return res.status(400).json({ message: 'Category and point are required' });
    }

    const validCategories = ['strength', 'weakness', 'opportunity'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category. Must be strength, weakness, or opportunity' });
    }

    const [result] = await db.query(
      'INSERT INTO lead_swot (lead_id, category, point, created_by) VALUES (?, ?, ?, ?)',
      [leadId, category, point.trim(), req.user.id]
    );

    const [rows] = await db.query(
      `SELECT s.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_swot s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Lead SWOT add error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/leads/:id/swot/:pointId
 * Remove a SWOT point
 */
exports.deleteSwotPoint = async (req, res) => {
  try {
    const { id: leadId, pointId } = req.params;

    const [rows] = await db.query(
      'SELECT * FROM lead_swot WHERE id = ? AND lead_id = ?',
      [pointId, leadId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'SWOT point not found' });
    }

    await db.query('DELETE FROM lead_swot WHERE id = ?', [pointId]);

    return res.json({ message: 'SWOT point deleted' });
  } catch (err) {
    console.error('Lead SWOT delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leads/:id/swot/:pointId
 * Update a SWOT point
 * Body: { point: string }
 */
exports.updateSwotPoint = async (req, res) => {
  try {
    const { id: leadId, pointId } = req.params;
    const { point } = req.body;

    if (!point || !point.trim()) {
      return res.status(400).json({ message: 'Point text is required' });
    }

    const [rows] = await db.query(
      'SELECT * FROM lead_swot WHERE id = ? AND lead_id = ?',
      [pointId, leadId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'SWOT point not found' });
    }

    await db.query('UPDATE lead_swot SET point = ? WHERE id = ?', [point.trim(), pointId]);

    return res.json({ ...rows[0], point: point.trim() });
  } catch (err) {
    console.error('Lead SWOT update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
