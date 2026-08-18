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

// Helper to parse JSON fields safely
function parseRow(row) {
  let sections = [];
  let page_targets = [];

  try {
    sections = row.sections
      ? (typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections)
      : [];
  } catch (e) { sections = []; }

  try {
    page_targets = row.page_targets
      ? (typeof row.page_targets === 'string' ? JSON.parse(row.page_targets) : row.page_targets)
      : [];
  } catch (e) { page_targets = []; }

  return { ...row, sections, page_targets };
}

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

    return res.json(rows.map(parseRow));
  } catch (err) {
    console.error('SMM Documents list error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET documents for a specific page (only where page is visible=true)
// ─────────────────────────────────────────────────────────────────────────────
exports.getByPage = async (req, res) => {
  try {
    const { page } = req.params;
    if (!VALID_PAGE_TARGETS.includes(page)) {
      return res.status(400).json({ message: 'Invalid page target' });
    }

    // Get all active documents — filter in JS to avoid JSON_CONTAINS compatibility issues
    const [rows] = await db.query(
      `SELECT id, title, sections, page_targets
       FROM smm_documents
       WHERE is_active = 1
       ORDER BY sort_order, created_at DESC`
    );

    // Filter: only documents that have this page with visible = true
    const results = [];
    for (const row of rows) {
      const parsed = parseRow(row);
      const pageTarget = parsed.page_targets.find(pt => pt.page === page && pt.visible === true);
      if (pageTarget) {
        results.push({
          id: parsed.id,
          title: parsed.title,
          sections: parsed.sections,
        });
      }
    }

    return res.json(results);
  } catch (err) {
    console.error('SMM Documents getByPage error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
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

    return res.json(parseRow(rows[0]));
  } catch (err) {
    console.error('SMM Documents getOne error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const { title, sections, page_targets, sort_order } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }
  if (!sections || !Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ message: 'At least one section is required' });
  }
  for (const section of sections) {
    if (!section.title || !section.title.trim()) {
      return res.status(400).json({ message: 'Each section must have a title' });
    }
  }
  if (!page_targets || !Array.isArray(page_targets) || page_targets.length === 0) {
    return res.status(400).json({ message: 'At least one page target is required' });
  }

  // Validate page targets
  for (const pt of page_targets) {
    if (!VALID_PAGE_TARGETS.includes(pt.page)) {
      return res.status(400).json({ message: `Invalid page target: ${pt.page}` });
    }
  }

  try {
    const sectionsJson = JSON.stringify(sections.map((s, idx) => {
      let description = (s.description || '').trim();
      // Decode base64-encoded descriptions from frontend (avoids WAF blocking HTML)
      if (s.encoded && description) {
        try {
          description = Buffer.from(description, 'base64').toString('utf8');
        } catch (e) { /* use as-is if decode fails */ }
      }
      return { title: s.title.trim(), description, order: idx };
    }));

    const pageTargetsJson = JSON.stringify(page_targets.map(pt => ({
      page: pt.page,
      visible: pt.visible !== undefined ? !!pt.visible : true,
    })));

    const [result] = await db.query(
      `INSERT INTO smm_documents (title, sections, page_targets, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [title.trim(), sectionsJson, pageTargetsJson, sort_order || 0, req.user.id]
    );

    const [created] = await db.query('SELECT * FROM smm_documents WHERE id = ?', [result.insertId]);
    return res.status(201).json(parseRow(created[0]));
  } catch (err) {
    console.error('SMM Documents create error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE document (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM smm_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const { title, sections, page_targets, sort_order } = req.body;
    const current = parseRow(rows[0]);

    // Validate sections if provided
    if (sections && Array.isArray(sections)) {
      for (const section of sections) {
        if (!section.title || !section.title.trim()) {
          return res.status(400).json({ message: 'Each section must have a title' });
        }
      }
    }

    // Validate page targets if provided
    if (page_targets && Array.isArray(page_targets)) {
      if (page_targets.length === 0) {
        return res.status(400).json({ message: 'At least one page target is required' });
      }
      for (const pt of page_targets) {
        if (!VALID_PAGE_TARGETS.includes(pt.page)) {
          return res.status(400).json({ message: `Invalid page target: ${pt.page}` });
        }
      }
    }

    const newSections = sections
      ? JSON.stringify(sections.map((s, idx) => {
          let description = (s.description || '').trim();
          if (s.encoded && description) {
            try {
              description = Buffer.from(description, 'base64').toString('utf8');
            } catch (e) { /* use as-is */ }
          }
          return { title: s.title.trim(), description, order: idx };
        }))
      : JSON.stringify(current.sections);

    const newPageTargets = page_targets
      ? JSON.stringify(page_targets.map(pt => ({
          page: pt.page,
          visible: pt.visible !== undefined ? !!pt.visible : true,
        })))
      : JSON.stringify(current.page_targets);

    await db.query(
      `UPDATE smm_documents SET
        title = ?, sections = ?, page_targets = ?, sort_order = ?
       WHERE id = ?`,
      [
        title !== undefined ? title.trim() : current.title,
        newSections,
        newPageTargets,
        sort_order !== undefined ? sort_order : current.sort_order,
        req.params.id,
      ]
    );

    const [updated] = await db.query('SELECT * FROM smm_documents WHERE id = ?', [req.params.id]);
    return res.json(parseRow(updated[0]));
  } catch (err) {
    console.error('SMM Documents update error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE page visibility for a document (admin only)
// PATCH /api/smm-documents/:id/toggle-page
// Body: { page: "content_writing", visible: true/false }
// ─────────────────────────────────────────────────────────────────────────────
exports.togglePageVisibility = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM smm_documents WHERE id = ? AND is_active = 1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const { page, visible } = req.body;
    if (!page || !VALID_PAGE_TARGETS.includes(page)) {
      return res.status(400).json({ message: 'Invalid page target' });
    }

    const doc = parseRow(rows[0]);
    const pageTargets = doc.page_targets.map(pt =>
      pt.page === page ? { ...pt, visible: !!visible } : pt
    );

    await db.query(
      'UPDATE smm_documents SET page_targets = ? WHERE id = ?',
      [JSON.stringify(pageTargets), req.params.id]
    );

    return res.json({ id: doc.id, page, visible: !!visible });
  } catch (err) {
    console.error('SMM Documents togglePage error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
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
    console.error('SMM Documents delete error:', err.message, err.sqlMessage);
    return res.status(500).json({ message: err.sqlMessage || err.message || 'Server error' });
  }
};
