const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// LIST all IBRS configs (optionally filter by industry_id)
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { industry_id } = req.query;
    let query = `SELECT t.*, i.name AS industry_name, i.icon AS industry_icon
                 FROM ibrs_templates t
                 LEFT JOIN pitch_deck_industries i ON i.id = t.industry_id
                 WHERE t.is_active = 1`;
    const params = [];

    if (industry_id) {
      query += ' AND t.industry_id = ?';
      params.push(parseInt(industry_id, 10));
    }

    query += ' ORDER BY t.industry_id, t.sort_order';

    const [rows] = await db.query(query, params);

    // Parse sections JSON
    const parsed = rows.map(row => ({
      ...row,
      sections: row.sections ? (typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections) : [],
    }));

    return res.json(parsed);
  } catch (err) {
    console.error('IBRS list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single IBRS config
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, i.name AS industry_name, i.icon AS industry_icon
       FROM ibrs_templates t
       LEFT JOIN pitch_deck_industries i ON i.id = t.industry_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'IBRS config not found' });

    const row = rows[0];
    row.sections = row.sections ? (typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections) : [];
    return res.json(row);
  } catch (err) {
    console.error('IBRS getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE IBRS config (industry + sections)
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const { industry_id, name, sections, sort_order } = req.body;

  if (!industry_id) return res.status(400).json({ message: 'Industry is required' });
  if (!sections || !Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ message: 'At least one section is required' });
  }

  // Validate each section has title
  for (const section of sections) {
    if (!section.title || !section.title.trim()) {
      return res.status(400).json({ message: 'Each section must have a title' });
    }
  }

  try {
    // Check if an IBRS already exists for this industry
    const [existing] = await db.query(
      'SELECT id FROM ibrs_templates WHERE industry_id = ? AND is_active = 1',
      [industry_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'An IBRS already exists for this industry. Edit the existing one instead.' });
    }

    const sectionsJson = JSON.stringify(sections.map((s, idx) => ({
      title: s.title.trim(),
      description: (s.description || '').trim(),
      order: idx,
    })));

    const [result] = await db.query(
      `INSERT INTO ibrs_templates (industry_id, name, sections, content, content_type, sort_order)
       VALUES (?, ?, ?, '', 'sections', ?)`,
      [industry_id, (name || '').trim() || null, sectionsJson, sort_order || 0]
    );

    const [created] = await db.query(
      `SELECT t.*, i.name AS industry_name, i.icon AS industry_icon
       FROM ibrs_templates t
       LEFT JOIN pitch_deck_industries i ON i.id = t.industry_id
       WHERE t.id = ?`,
      [result.insertId]
    );

    const row = created[0];
    row.sections = row.sections ? (typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections) : [];
    return res.status(201).json(row);
  } catch (err) {
    console.error('IBRS create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE IBRS config
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ibrs_templates WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'IBRS config not found' });

    const { industry_id, name, sections, sort_order, is_active } = req.body;
    const current = rows[0];

    let sectionsJson = current.sections;
    if (sections && Array.isArray(sections)) {
      for (const section of sections) {
        if (!section.title || !section.title.trim()) {
          return res.status(400).json({ message: 'Each section must have a title' });
        }
      }
      sectionsJson = JSON.stringify(sections.map((s, idx) => ({
        title: s.title.trim(),
        description: (s.description || '').trim(),
        order: idx,
      })));
    }

    // If changing industry, check no conflict
    const newIndustryId = industry_id !== undefined ? industry_id : current.industry_id;
    if (industry_id && industry_id !== current.industry_id) {
      const [existing] = await db.query(
        'SELECT id FROM ibrs_templates WHERE industry_id = ? AND is_active = 1 AND id != ?',
        [industry_id, req.params.id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ message: 'An IBRS already exists for that industry.' });
      }
    }

    await db.query(
      `UPDATE ibrs_templates SET
        industry_id = ?, name = ?, sections = ?, content_type = 'sections', sort_order = ?, is_active = ?
       WHERE id = ?`,
      [
        newIndustryId,
        name !== undefined ? (name || '').trim() || null : current.name,
        sectionsJson,
        sort_order !== undefined ? sort_order : current.sort_order,
        is_active !== undefined ? (is_active ? 1 : 0) : current.is_active,
        req.params.id,
      ]
    );

    const [updated] = await db.query(
      `SELECT t.*, i.name AS industry_name, i.icon AS industry_icon
       FROM ibrs_templates t
       LEFT JOIN pitch_deck_industries i ON i.id = t.industry_id
       WHERE t.id = ?`,
      [req.params.id]
    );

    const row = updated[0];
    row.sections = row.sections ? (typeof row.sections === 'string' ? JSON.parse(row.sections) : row.sections) : [];
    return res.json(row);
  } catch (err) {
    console.error('IBRS update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (soft) IBRS config
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ibrs_templates WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'IBRS config not found' });

    await db.query('UPDATE ibrs_templates SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'IBRS config deleted' });
  } catch (err) {
    console.error('IBRS delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET IBRS for a project (by project's client industry)
// ─────────────────────────────────────────────────────────────────────────────
exports.getByProject = async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);

    // Get the project's client → client's industry
    const [projectRows] = await db.query(
      `SELECT p.client_id, oa.industry
       FROM projects p
       LEFT JOIN client_onboarding_a oa ON oa.client_id = p.client_id
       WHERE p.id = ? AND p.deleted = 0`,
      [projectId]
    );

    if (projectRows.length === 0) return res.status(404).json({ message: 'Project not found' });

    const industry = projectRows[0].industry;
    if (!industry) {
      return res.json({ industry: null, sections: [] });
    }

    // Find matching industry in pitch_deck_industries by name
    const [industryRows] = await db.query(
      'SELECT id, name, icon FROM pitch_deck_industries WHERE name LIKE ? AND is_active = 1',
      [`%${industry}%`]
    );

    if (industryRows.length === 0) {
      return res.json({ industry: industry, industry_id: null, sections: [] });
    }

    const industryId = industryRows[0].id;

    // Get IBRS config for this industry
    const [templates] = await db.query(
      'SELECT * FROM ibrs_templates WHERE industry_id = ? AND is_active = 1 ORDER BY sort_order LIMIT 1',
      [industryId]
    );

    if (templates.length === 0) {
      return res.json({
        industry: industryRows[0].name,
        industry_id: industryId,
        industry_icon: industryRows[0].icon,
        sections: [],
      });
    }

    const ibrs = templates[0];
    const sections = ibrs.sections ? (typeof ibrs.sections === 'string' ? JSON.parse(ibrs.sections) : ibrs.sections) : [];

    return res.json({
      industry: industryRows[0].name,
      industry_id: industryId,
      industry_icon: industryRows[0].icon,
      ibrs_name: ibrs.name,
      sections,
    });
  } catch (err) {
    console.error('IBRS getByProject error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
