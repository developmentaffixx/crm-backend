const db = require('../config/db');

/**
 * GET /api/leads/:id/swot/notes
 * Fetch the single notes paragraph for a lead
 */
exports.getNotes = async (req, res) => {
  try {
    const leadId = req.params.id;

    const [rows] = await db.query(
      `SELECT n.*, CONCAT(u.first_name, ' ', u.last_name) AS updated_by_name
       FROM lead_swot_notes n
       LEFT JOIN users u ON u.id = n.updated_by
       WHERE n.lead_id = ?`,
      [leadId]
    );

    return res.json(rows[0] || { notes: '', lead_id: leadId });
  } catch (err) {
    console.error('Lead SWOT notes get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leads/:id/swot/notes
 * Create or update the notes paragraph for a lead
 * Body: { notes: string }
 */
exports.saveNotes = async (req, res) => {
  try {
    const leadId = req.params.id;
    const { notes } = req.body;

    if (notes === undefined || notes === null) {
      return res.status(400).json({ message: 'Notes field is required' });
    }

    // Upsert: insert or update
    await db.query(
      `INSERT INTO lead_swot_notes (lead_id, notes, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE notes = VALUES(notes), updated_by = VALUES(updated_by)`,
      [leadId, notes.trim(), req.user.id]
    );

    const [rows] = await db.query(
      `SELECT n.*, CONCAT(u.first_name, ' ', u.last_name) AS updated_by_name
       FROM lead_swot_notes n
       LEFT JOIN users u ON u.id = n.updated_by
       WHERE n.lead_id = ?`,
      [leadId]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error('Lead SWOT notes save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
