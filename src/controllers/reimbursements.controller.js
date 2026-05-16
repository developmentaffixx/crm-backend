const db = require('../config/db');
const path = require('path');
const fs   = require('fs');

/**
 * GET /api/reimbursements
 * Admin: all requests; Employee: own requests
 */
exports.list = async (req, res) => {
  try {
    const { status, search } = req.query;
    const isAdmin = req.user.is_admin;

    let sql = `
      SELECT r.*,
             CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
             u.department,
             CONCAT(a.first_name, ' ', a.last_name) AS approved_by_name
      FROM reimbursements r
      INNER JOIN users u ON u.id = r.user_id
      LEFT JOIN users a ON a.id = r.approved_by
      WHERE r.deleted = 0
    `;
    const params = [];

    if (!isAdmin) {
      sql += ' AND r.user_id = ?';
      params.push(req.user.id);
    }

    if (status && status !== 'all') {
      sql += ' AND r.status = ?';
      params.push(status);
    }

    if (search) {
      sql += " AND (u.first_name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY r.created_at DESC';

    const [rows] = await db.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Reimbursements list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/reimbursements/stats
 */
exports.stats = async (req, res) => {
  try {
    const [pending] = await db.query(
      "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM reimbursements WHERE status = 'pending' AND deleted = 0"
    );
    const [approvedMonth] = await db.query(
      "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM reimbursements WHERE status = 'approved' AND deleted = 0 AND MONTH(updated_at) = MONTH(CURDATE()) AND YEAR(updated_at) = YEAR(CURDATE())"
    );
    const [paidMonth] = await db.query(
      "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM reimbursements WHERE status = 'paid' AND deleted = 0 AND MONTH(paid_at) = MONTH(CURDATE()) AND YEAR(paid_at) = YEAR(CURDATE())"
    );

    return res.json({
      pending_count: pending[0].count,
      pending_amount: pending[0].total,
      approved_count: approvedMonth[0].count,
      approved_amount: approvedMonth[0].total,
      paid_count: paidMonth[0].count,
      paid_amount: paidMonth[0].total,
    });
  } catch (err) {
    console.error('Reimbursements stats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/reimbursements
 * Employee submits a reimbursement
 */
exports.create = async (req, res) => {
  try {
    const { category, amount, expense_date, description, is_group, group_members } = req.body;
    if (!category || !amount || !expense_date || !description) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    let receiptUrl = null;
    if (req.file) {
      const filename = `receipt-${req.user.id}-${Date.now()}${path.extname(req.file.originalname)}`;
      const uploadDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      receiptUrl = `/uploads/${filename}`;
    }

    const [result] = await db.query(
      `INSERT INTO reimbursements (user_id, category, amount, expense_date, description, receipt_url, is_group, group_members)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, category, amount, expense_date, description, receiptUrl, is_group ? 1 : 0, group_members ? JSON.stringify(group_members) : null]
    );

    return res.status(201).json({ message: 'Reimbursement submitted', id: result.insertId });
  } catch (err) {
    console.error('Create reimbursement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/reimbursements/:id/approve
 */
exports.approve = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [rows] = await db.query('SELECT * FROM reimbursements WHERE id = ? AND deleted = 0', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    await db.query(
      "UPDATE reimbursements SET status = 'approved', approved_by = ?, remarks = ?, updated_at = NOW() WHERE id = ?",
      [req.user.id, remarks || null, id]
    );
    return res.json({ message: 'Reimbursement approved' });
  } catch (err) {
    console.error('Approve reimbursement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/reimbursements/:id/reject
 */
exports.reject = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [rows] = await db.query('SELECT * FROM reimbursements WHERE id = ? AND deleted = 0', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    await db.query(
      "UPDATE reimbursements SET status = 'rejected', approved_by = ?, remarks = ?, updated_at = NOW() WHERE id = ?",
      [req.user.id, remarks || null, id]
    );
    return res.json({ message: 'Reimbursement rejected' });
  } catch (err) {
    console.error('Reject reimbursement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/reimbursements/:id/mark-paid
 */
exports.markPaid = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query('SELECT * FROM reimbursements WHERE id = ? AND deleted = 0', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    if (rows[0].status !== 'approved') {
      return res.status(400).json({ message: 'Only approved requests can be marked as paid' });
    }

    await db.query(
      "UPDATE reimbursements SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ?",
      [id]
    );
    return res.json({ message: 'Marked as paid' });
  } catch (err) {
    console.error('Mark paid error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/reimbursements/:id
 * Employee cancels own pending request
 */
exports.cancel = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT * FROM reimbursements WHERE id = ? AND user_id = ? AND deleted = 0',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    await db.query('UPDATE reimbursements SET deleted = 1, updated_at = NOW() WHERE id = ?', [id]);
    return res.json({ message: 'Reimbursement cancelled' });
  } catch (err) {
    console.error('Cancel reimbursement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
