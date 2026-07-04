const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

// ─── GET /api/revenue-intro-documents ─────────────────────────────────────────
// List all intro documents (accessible to all authenticated users)
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM revenue_intro_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       ORDER BY d.created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('RevenueIntroDocuments list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/revenue-intro-documents ────────────────────────────────────────
// Upload a new document (admin only)
exports.create = async (req, res) => {
  try {
    const { name } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'File is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Document name is required' });
    }

    // Upload PDFs and images as 'image' resource_type so Cloudinary serves them inline (not as download)
    // Cloudinary supports PDF under 'image' resource_type for inline viewing
    const resourceType = 'image';

    const { url, public_id } = await uploadToCloudinary(
      file.buffer,
      'crm/revenue-intro-documents',
      resourceType
    );

    // Determine file type from extension/mimetype
    let fileType = 'other';
    if (file.mimetype === 'application/pdf') fileType = 'pdf';
    else if (file.mimetype.startsWith('image/')) fileType = 'image';

    const [result] = await db.query(
      `INSERT INTO revenue_intro_documents (name, file_url, cloudinary_id, file_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), url, public_id, fileType, req.user.id]
    );

    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM revenue_intro_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('RevenueIntroDocuments create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/revenue-intro-documents/:id ─────────────────────────────────────
// Update document name (admin only)
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Document name is required' });
    }

    const [existing] = await db.query('SELECT * FROM revenue_intro_documents WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // If a new file is uploaded, replace the old one
    let updateFields = 'name = ?';
    let params = [name.trim()];

    if (req.file) {
      // Delete old file from Cloudinary
      if (existing[0].cloudinary_id) {
        await deleteFromCloudinary(existing[0].cloudinary_id, 'image');
      }

      // Upload as 'image' resource_type for inline viewing
      const { url, public_id } = await uploadToCloudinary(
        req.file.buffer,
        'crm/revenue-intro-documents',
        'image'
      );

      let fileType = 'other';
      if (req.file.mimetype === 'application/pdf') fileType = 'pdf';
      else if (req.file.mimetype.startsWith('image/')) fileType = 'image';

      updateFields += ', file_url = ?, cloudinary_id = ?, file_type = ?';
      params.push(url, public_id, fileType);
    }

    params.push(id);
    await db.query(`UPDATE revenue_intro_documents SET ${updateFields} WHERE id = ?`, params);

    const [rows] = await db.query(
      `SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM revenue_intro_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = ?`,
      [id]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error('RevenueIntroDocuments update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/revenue-intro-documents/:id ──────────────────────────────────
// Delete a document (admin only)
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT * FROM revenue_intro_documents WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete from Cloudinary
    if (existing[0].cloudinary_id) {
      await deleteFromCloudinary(existing[0].cloudinary_id, 'image');
    }

    await db.query('DELETE FROM revenue_intro_documents WHERE id = ?', [id]);

    return res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error('RevenueIntroDocuments delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
