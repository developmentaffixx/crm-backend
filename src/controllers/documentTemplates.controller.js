const db = require('../config/db');

/**
 * GET /api/settings/document-templates
 * List all document templates
 */
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, template_key, label, description, placeholders, updated_at FROM document_templates ORDER BY id'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Document templates list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/settings/document-templates/:key
 * Get a single template by key (includes full content)
 */
exports.getByKey = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM document_templates WHERE template_key = ?',
      [req.params.key]
    );
    if (!rows.length) return res.status(404).json({ message: 'Template not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Document template get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/document-templates/:key
 * Update template content
 */
exports.update = async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Content is required' });

    const [result] = await db.query(
      'UPDATE document_templates SET content = ?, updated_at = NOW() WHERE template_key = ?',
      [content, req.params.key]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Template not found' });
    }
    return res.json({ message: 'Template updated successfully' });
  } catch (err) {
    console.error('Document template update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/rule-book
 * Public (authenticated) endpoint to fetch rule book content for all users
 */
exports.getRuleBook = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM document_templates WHERE template_key = ?',
      ['rule_book']
    );
    if (!rows.length) return res.status(404).json({ message: 'Rule Book not configured' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Rule book fetch error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
