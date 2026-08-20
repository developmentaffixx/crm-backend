const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// LIST — GET /api/settings/mpr-prompt-templates
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM mpr_prompt_templates WHERE is_active = 1 ORDER BY sort_order, created_at'
    );
    return res.json(rows);
  } catch (err) {
    console.error('MPR Prompt Templates list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ONE — GET /api/settings/mpr-prompt-templates/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM mpr_prompt_templates WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Template not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('MPR Prompt Templates getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE — POST /api/settings/mpr-prompt-templates
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { name, description, prompt_body, sort_order } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
    if (!prompt_body || !prompt_body.trim()) return res.status(400).json({ message: 'Prompt body is required' });

    const [result] = await db.query(
      'INSERT INTO mpr_prompt_templates (name, description, prompt_body, sort_order) VALUES (?, ?, ?, ?)',
      [name.trim(), description?.trim() || null, prompt_body.trim(), sort_order || 0]
    );

    const [created] = await db.query('SELECT * FROM mpr_prompt_templates WHERE id = ?', [result.insertId]);
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('MPR Prompt Templates create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — PUT /api/settings/mpr-prompt-templates/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM mpr_prompt_templates WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Template not found' });

    const { name, description, prompt_body, sort_order } = req.body;

    if (name !== undefined && !name.trim()) return res.status(400).json({ message: 'Name cannot be empty' });
    if (prompt_body !== undefined && !prompt_body.trim()) return res.status(400).json({ message: 'Prompt body cannot be empty' });

    await db.query(
      `UPDATE mpr_prompt_templates SET
        name = ?, description = ?, prompt_body = ?, sort_order = ?
       WHERE id = ?`,
      [
        name !== undefined ? name.trim() : existing[0].name,
        description !== undefined ? (description?.trim() || null) : existing[0].description,
        prompt_body !== undefined ? prompt_body.trim() : existing[0].prompt_body,
        sort_order !== undefined ? sort_order : existing[0].sort_order,
        req.params.id,
      ]
    );

    const [updated] = await db.query('SELECT * FROM mpr_prompt_templates WHERE id = ?', [req.params.id]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('MPR Prompt Templates update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — DELETE /api/settings/mpr-prompt-templates/:id (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM mpr_prompt_templates WHERE id = ? AND is_active = 1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Template not found' });

    await db.query('UPDATE mpr_prompt_templates SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Template deleted' });
  } catch (err) {
    console.error('MPR Prompt Templates delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
