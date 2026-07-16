const db = require('../config/db');

// ─── GET /api/software-licenses ───────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, search, billing_cycle } = req.query;
    let where = 'sl.deleted = 0';
    const params = [];

    if (status) { where += ' AND sl.status = ?'; params.push(status); }
    if (billing_cycle) { where += ' AND sl.billing_cycle = ?'; params.push(billing_cycle); }
    if (search) {
      where += ' AND (sl.software_name LIKE ? OR sl.vendor LIKE ? OR sl.assigned_to LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT sl.*,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM software_licenses sl
       LEFT JOIN users cu ON cu.id = sl.created_by
       WHERE ${where}
       ORDER BY sl.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_cost: rows.reduce((sum, r) => sum + parseFloat(r.cost || 0), 0),
      active: rows.filter(r => r.status === 'Active').length,
      expired: rows.filter(r => r.status === 'Expired').length,
      cancelled: rows.filter(r => r.status === 'Cancelled').length,
      trial: rows.filter(r => r.status === 'Trial').length,
    };

    return res.json({ licenses: rows, summary });
  } catch (err) {
    console.error('Software licenses list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/software-licenses/:id ───────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT sl.*,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM software_licenses sl
       LEFT JOIN users cu ON cu.id = sl.created_by
       WHERE sl.id = ? AND sl.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'License not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Software license getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/software-licenses ──────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      software_name, vendor, license_type, license_key, cost,
      billing_cycle, total_seats, start_date, expiry_date,
      assigned_to, status, notes
    } = req.body;

    if (!software_name) return res.status(400).json({ message: 'Software name is required' });
    if (!cost && cost !== 0) return res.status(400).json({ message: 'Cost is required' });
    if (!start_date) return res.status(400).json({ message: 'Start date is required' });

    const [result] = await db.query(
      `INSERT INTO software_licenses (
        software_name, vendor, license_type, license_key, cost,
        billing_cycle, total_seats, start_date, expiry_date,
        assigned_to, status, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        software_name,
        vendor || null,
        license_type || 'Subscription',
        license_key || null,
        parseFloat(cost || 0),
        billing_cycle || 'Monthly',
        total_seats || null,
        start_date,
        expiry_date || null,
        assigned_to || null,
        status || 'Active',
        notes || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT sl.*, CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM software_licenses sl
       LEFT JOIN users cu ON cu.id = sl.created_by
       WHERE sl.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Software license create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/software-licenses/:id ───────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM software_licenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'License not found' });

    const existing = rows[0];
    const {
      software_name, vendor, license_type, license_key, cost,
      billing_cycle, total_seats, start_date, expiry_date,
      assigned_to, status, notes
    } = req.body;

    await db.query(
      `UPDATE software_licenses SET
        software_name = ?, vendor = ?, license_type = ?, license_key = ?, cost = ?,
        billing_cycle = ?, total_seats = ?, start_date = ?, expiry_date = ?,
        assigned_to = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        software_name !== undefined ? software_name : existing.software_name,
        vendor !== undefined ? vendor : existing.vendor,
        license_type || existing.license_type,
        license_key !== undefined ? license_key : existing.license_key,
        cost !== undefined ? parseFloat(cost) : existing.cost,
        billing_cycle || existing.billing_cycle,
        total_seats !== undefined ? total_seats : existing.total_seats,
        start_date || existing.start_date,
        expiry_date !== undefined ? expiry_date : existing.expiry_date,
        assigned_to !== undefined ? assigned_to : existing.assigned_to,
        status || existing.status,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT sl.*, CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM software_licenses sl
       LEFT JOIN users cu ON cu.id = sl.created_by
       WHERE sl.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Software license update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/software-licenses/:id (soft delete) ──────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM software_licenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'License not found' });

    await db.query('UPDATE software_licenses SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'License deleted' });
  } catch (err) {
    console.error('Software license delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/software-licenses/:id/renew ────────────────────────────────────
exports.renew = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM software_licenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'License not found' });

    const existing = rows[0];
    const { new_expiry, cost, notes } = req.body;

    if (!new_expiry) return res.status(400).json({ message: 'New expiry date is required' });

    const previousExpiry = existing.expiry_date;
    const newCost = cost !== undefined ? parseFloat(cost) : parseFloat(existing.cost);

    // Insert renewal history record
    await db.query(
      `INSERT INTO software_license_renewals (license_id, previous_expiry, new_expiry, cost_at_renewal, notes, renewed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, previousExpiry, new_expiry, newCost, notes || null, req.user.id]
    );

    // Update the license with new expiry and cost
    await db.query(
      `UPDATE software_licenses SET expiry_date = ?, cost = ?, status = 'Active' WHERE id = ?`,
      [new_expiry, newCost, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT sl.*, CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM software_licenses sl
       LEFT JOIN users cu ON cu.id = sl.created_by
       WHERE sl.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Software license renew error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/software-licenses/:id/history ───────────────────────────────────
exports.getHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*,
              CONCAT(u.first_name, ' ', u.last_name) AS renewed_by_name
       FROM software_license_renewals r
       LEFT JOIN users u ON u.id = r.renewed_by
       WHERE r.license_id = ?
       ORDER BY r.renewed_at DESC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Software license history error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
