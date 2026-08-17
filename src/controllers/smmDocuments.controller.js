const db = require('../config/db');

// Valid page target keys
const VALID_PAGE_TARGETS = [
  'social_overview',
  'content_calendar',
  'content_writing',
  'shoots',
  'ads',
  'daily_journal',
  'report_centre',
];

// ─────────────────────────────────────────────────────────────────────────────
// LIST all SMM documents (admin settings view)
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_documents d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.is_active = 1
       ORDER BY d.sort_order, d.created_at DESC`
    );

    const parsed = rows.map(row => ({
      ...row,
      page_targets: row.page_targets
        ? (typeof row.page_targets === 'string' ? JSON.parse(row.page_targets) : row.page_targets)
        : [],
    }));

    return res.json(parsed);
  } catch (err) {
    console.error('SMM Documents list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET documents for a specific page (used by frontend pages)
// ─────────────────────────────────────────────────────────────────────────────
exports.getByPage = async (req, res) => {
  try {
    const { page } = req.params;
    if (!VALID_PAGE_TARGETS.includes(page)) {
      return res.status(400).json({ message: 'Invalid page target' });
    }

    const [rows] = await db.query(
      `SELECT id, title, content
       FROM smm_documents
       WHERE is_active = 1 AND is_visible = 1
         AND JSON_CONTAINS(page_targets, ?)
       ORDER BY sort_order, created_at DESC`,
      [JSON.stringify(page)]
    );

    return res.json(rows);
  } catch (err) {
    console.error('SMM Documents getByPage error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single document
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM smm_documents WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const row = rows[0];
    row.page_targets = row.page_targets
      ? (typeof row.page_targets === 'string' ? JSON.parse(row.page_targets) : row.page_targets)
      : [];

    return res.json(row);
  } catch (err) {
    console.error('SMM Documents getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const { title, content, page_targets, is_visible, sort_order } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }
  if (!page_targets || !Array.isArray(page_targets) || page_targets.length === 0) {
    return res.status(400).json({ message: 'At least one page target is required' });
  }

  // Validate page targets
  const invalidTargets = page_targets.filter(t => !VALID_PAGE_TARGETS.includes(t));
  if (invalidTargets.length > 0) {
    return res.status(400).json({ message: `Invalid page targets: ${invalidTargets.join(', ')}` });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO smm_documents (title, content, page_targets, is_visible, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        content || null,
        JSON.stringify(page_targets),
        is_visible !== undefined ? (is_visible ? 1 : 0) : 1,
        sort_order || 0,
        req.user.id,
      ]
    );

    const [created] = await db.query('SELECT * FROM smm_documents WHERE id = ?', [result.insertId]);
    const row = created[0];
    row.page_targets = typeof row.page_targets === 'string' ? JSON.parse(row.page_targets) : row.page_targets;

    return res.status(201).json(row);
  } catch (err) {
    console.error('SMM Documents create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM smm_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const { title, content, page_targets, is_visible, sort_order } = req.body;

    if (page_targets && Array.isArray(page_targets)) {
      const invalidTargets = page_targets.filter(t => !VALID_PAGE_TARGETS.includes(t));
      if (invalidTargets.length > 0) {
        return res.status(400).json({ message: `Invalid page targets: ${invalidTargets.join(', ')}` });
      }
      if (page_targets.length === 0) {
        return res.status(400).json({ message: 'At least one page target is required' });
      }
    }

    const current = rows[0];

    await db.query(
      `UPDATE smm_documents SET
        title = ?, content = ?, page_targets = ?, is_visible = ?, sort_order = ?
       WHERE id = ?`,
      [
        title !== undefined ? title.trim() : current.title,
        content !== undefined ? content : current.content,
        page_targets ? JSON.stringify(page_targets) : current.page_targets,
        is_visible !== undefined ? (is_visible ? 1 : 0) : current.is_visible,
        sort_order !== undefined ? sort_order : current.sort_order,
        req.params.id,
      ]
    );

    const [updated] = await db.query('SELECT * FROM smm_documents WHERE id = ?', [req.params.id]);
    const row = updated[0];
    row.page_targets = typeof row.page_targets === 'string' ? JSON.parse(row.page_targets) : row.page_targets;

    return res.json(row);
  } catch (err) {
    console.error('SMM Documents update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE visibility (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.toggleVisibility = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM smm_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const newVisible = rows[0].is_visible ? 0 : 1;
    await db.query('UPDATE smm_documents SET is_visible = ? WHERE id = ?', [newVisible, req.params.id]);

    return res.json({ id: rows[0].id, is_visible: !!newVisible });
  } catch (err) {
    console.error('SMM Documents toggle error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (soft) document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM smm_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    await db.query('UPDATE smm_documents SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('SMM Documents delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
