const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ─────────────────────────────────────────────────────────────────────────────
// LIST all IBRS templates (optionally filter by industry_id)
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
    return res.json(rows);
  } catch (err) {
    console.error('IBRS templates list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single IBRS template
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
    if (rows.length === 0) return res.status(404).json({ message: 'IBRS template not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('IBRS templates getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE IBRS template (now with file upload)
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const { industry_id, name, sort_order } = req.body;
  const file = req.file;

  if (!industry_id) return res.status(400).json({ message: 'Industry is required' });
  if (!file) return res.status(400).json({ message: 'Document file is required' });
  if (!name || !name.trim()) return res.status(400).json({ message: 'Document name is required' });

  try {
    // Upload to Cloudinary
    const resourceType = file.mimetype.startsWith('image/') ? 'image' : 'raw';
    const { url, public_id } = await uploadToCloudinary(
      file.buffer,
      'crm/ibrs-documents',
      resourceType
    );

    // Determine file type
    let fileType = 'other';
    if (file.mimetype === 'application/pdf') fileType = 'pdf';
    else if (file.mimetype.startsWith('image/')) fileType = 'image';

    const [result] = await db.query(
      `INSERT INTO ibrs_templates (industry_id, name, content, content_type, file_url, cloudinary_id, file_type, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [industry_id, name.trim(), '', 'document', url, public_id, fileType, sort_order || 0]
    );

    const [created] = await db.query(
      `SELECT t.*, i.name AS industry_name, i.icon AS industry_icon
       FROM ibrs_templates t
       LEFT JOIN pitch_deck_industries i ON i.id = t.industry_id
       WHERE t.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('IBRS templates create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE IBRS template
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ibrs_templates WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'IBRS template not found' });

    const { industry_id, name, sort_order, is_active } = req.body;
    const current = rows[0];

    let fileUrl = current.file_url;
    let cloudinaryId = current.cloudinary_id;
    let fileType = current.file_type;

    // If new file uploaded, replace old one
    if (req.file) {
      // Delete old file from Cloudinary
      if (current.cloudinary_id) {
        const oldResourceType = current.file_type === 'image' ? 'image' : 'raw';
        await deleteFromCloudinary(current.cloudinary_id, oldResourceType);
      }

      const resourceType = req.file.mimetype.startsWith('image/') ? 'image' : 'raw';
      const { url, public_id } = await uploadToCloudinary(
        req.file.buffer,
        'crm/ibrs-documents',
        resourceType
      );

      fileUrl = url;
      cloudinaryId = public_id;
      if (req.file.mimetype === 'application/pdf') fileType = 'pdf';
      else if (req.file.mimetype.startsWith('image/')) fileType = 'image';
      else fileType = 'other';
    }

    await db.query(
      `UPDATE ibrs_templates SET
        industry_id = ?, name = ?, content_type = ?, file_url = ?, cloudinary_id = ?, file_type = ?, sort_order = ?, is_active = ?
       WHERE id = ?`,
      [
        industry_id !== undefined ? industry_id : current.industry_id,
        name !== undefined ? name.trim() : current.name,
        'document',
        fileUrl,
        cloudinaryId,
        fileType,
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
    return res.json(updated[0]);
  } catch (err) {
    console.error('IBRS templates update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (soft) IBRS template
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ibrs_templates WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'IBRS template not found' });

    // Delete from Cloudinary
    if (rows[0].cloudinary_id) {
      const resourceType = rows[0].file_type === 'image' ? 'image' : 'raw';
      await deleteFromCloudinary(rows[0].cloudinary_id, resourceType);
    }

    await db.query('UPDATE ibrs_templates SET is_active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'IBRS template deleted' });
  } catch (err) {
    console.error('IBRS templates delete error:', err);
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
      return res.json({ industry: null, templates: [] });
    }

    // Find matching industry in pitch_deck_industries by name
    const [industryRows] = await db.query(
      'SELECT id, name, icon FROM pitch_deck_industries WHERE name LIKE ? AND is_active = 1',
      [`%${industry}%`]
    );

    if (industryRows.length === 0) {
      return res.json({ industry: industry, industry_id: null, templates: [] });
    }

    const industryId = industryRows[0].id;

    // Get IBRS templates for this industry
    const [templates] = await db.query(
      'SELECT * FROM ibrs_templates WHERE industry_id = ? AND is_active = 1 ORDER BY sort_order',
      [industryId]
    );

    return res.json({
      industry: industryRows[0].name,
      industry_id: industryId,
      industry_icon: industryRows[0].icon,
      templates,
    });
  } catch (err) {
    console.error('IBRS getByProject error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
