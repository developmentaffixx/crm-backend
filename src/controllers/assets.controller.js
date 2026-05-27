const db = require('../config/db');
const path = require('path');
const fs = require('fs');

// ─── Helper: Generate next asset tag ──────────────────────────────────────────
async function generateAssetTag() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const prefix = `AST-${yy}`;
  const [rows] = await db.query(
    `SELECT asset_tag FROM assets WHERE asset_tag LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}-%`]
  );
  if (rows.length === 0) return `${prefix}-001`;
  const last = rows[0].asset_tag; // e.g. AST-25-042
  const parts = last.split('-');
  const num = parseInt(parts[parts.length - 1], 10) + 1;
  return `${prefix}-${String(num).padStart(3, '0')}`;
}

// ─── Helper: Save uploaded file ───────────────────────────────────────────────
function saveFile(file, prefix) {
  const filename = `${prefix}-${Date.now()}${path.extname(file.originalname)}`;
  const uploadDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, file.buffer);
  return `/uploads/${filename}`;
}

// ─── GET /api/assets ──────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { operational_status, condition_status, category, search } = req.query;
    let where = 'a.deleted = 0';
    const params = [];

    if (operational_status) { where += ' AND a.operational_status = ?'; params.push(operational_status); }
    if (condition_status) { where += ' AND a.condition_status = ?'; params.push(condition_status); }
    if (category) { where += ' AND a.category = ?'; params.push(category); }
    if (search) {
      where += ' AND (a.asset_name LIKE ? OR a.asset_tag LIKE ? OR a.serial_number LIKE ? OR a.brand LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [rows] = await db.query(
      `SELECT a.*,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name,
              CONCAT(ru.first_name, ' ', ru.last_name) AS received_by_name,
              CONCAT(pu.first_name, ' ', pu.last_name) AS purchased_by_name
       FROM assets a
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       LEFT JOIN users ru ON ru.id = a.received_by
       LEFT JOIN users pu ON pu.id = a.purchased_by
       WHERE ${where}
       ORDER BY a.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_value: rows.reduce((sum, r) => sum + parseFloat(r.asset_value || 0), 0),
      in_stock: rows.filter(r => r.operational_status === 'In Stock').length,
      issued: rows.filter(r => r.operational_status === 'Issued').length,
      under_maintenance: rows.filter(r => r.operational_status === 'Under Maintenance').length,
      retired: rows.filter(r => r.operational_status === 'Retired').length,
      disposed: rows.filter(r => r.operational_status === 'Disposed').length,
    };

    return res.json({ assets: rows, summary });
  } catch (err) {
    console.error('Assets list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/assets/:id ──────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name,
              CONCAT(ru.first_name, ' ', ru.last_name) AS received_by_name,
              CONCAT(pu.first_name, ' ', pu.last_name) AS purchased_by_name
       FROM assets a
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       LEFT JOIN users ru ON ru.id = a.received_by
       LEFT JOIN users pu ON pu.id = a.purchased_by
       WHERE a.id = ? AND a.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Asset not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Asset getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/assets ─────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      asset_name, category, type, brand, model, serial_number,
      operational_status, condition_status, assigned_to,
      purchase_type, platform_name, received_by, shop_vendor_name, purchased_by,
      purchase_date, asset_value
    } = req.body;

    if (!asset_name) {
      return res.status(400).json({ message: 'Asset name is required' });
    }

    const asset_tag = await generateAssetTag();

    // Handle file uploads
    let invoice_photo = null;
    let asset_photo = null;
    if (req.files) {
      if (req.files.invoice_photo && req.files.invoice_photo[0]) {
        invoice_photo = saveFile(req.files.invoice_photo[0], 'asset-invoice');
      }
      if (req.files.asset_photo && req.files.asset_photo[0]) {
        asset_photo = saveFile(req.files.asset_photo[0], 'asset-photo');
      }
    }

    const [result] = await db.query(
      `INSERT INTO assets (
        asset_tag, asset_name, category, type, brand, model, serial_number,
        operational_status, condition_status, assigned_to,
        purchase_type, platform_name, received_by, shop_vendor_name, purchased_by,
        purchase_date, asset_value, invoice_photo, asset_photo, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset_tag,
        asset_name,
        category || 'Physical',
        type || null,
        brand || null,
        model || null,
        serial_number || null,
        operational_status || 'In Stock',
        condition_status || 'Working',
        assigned_to || null,
        purchase_type || 'Offline',
        purchase_type === 'Online' ? (platform_name || null) : null,
        purchase_type === 'Online' ? (received_by || null) : null,
        purchase_type === 'Offline' ? (shop_vendor_name || null) : null,
        purchase_type === 'Offline' ? (purchased_by || null) : null,
        purchase_date || null,
        parseFloat(asset_value || 0),
        invoice_photo,
        asset_photo,
        req.user.id
      ]
    );

    // If assigned_to is set, create assignment history
    if (assigned_to) {
      await db.query(
        `INSERT INTO asset_assignment_history (asset_id, assigned_to, assigned_by, assigned_date)
         VALUES (?, ?, ?, ?)`,
        [result.insertId, assigned_to, req.user.id, purchase_date || new Date().toISOString().split('T')[0]]
      );
    }

    const [created] = await db.query(
      `SELECT a.*, CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM assets a
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       WHERE a.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Asset create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/assets/:id ──────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM assets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Asset not found' });

    const existing = rows[0];
    const {
      asset_name, category, type, brand, model, serial_number,
      operational_status, condition_status, assigned_to,
      purchase_type, platform_name, received_by, shop_vendor_name, purchased_by,
      purchase_date, asset_value
    } = req.body;

    // Handle file uploads
    let invoice_photo = existing.invoice_photo;
    let asset_photo = existing.asset_photo;
    if (req.files) {
      if (req.files.invoice_photo && req.files.invoice_photo[0]) {
        invoice_photo = saveFile(req.files.invoice_photo[0], 'asset-invoice');
      }
      if (req.files.asset_photo && req.files.asset_photo[0]) {
        asset_photo = saveFile(req.files.asset_photo[0], 'asset-photo');
      }
    }

    const newPurchaseType = purchase_type || existing.purchase_type;

    await db.query(
      `UPDATE assets SET
        asset_name = ?, category = ?, type = ?, brand = ?, model = ?, serial_number = ?,
        operational_status = ?, condition_status = ?, assigned_to = ?,
        purchase_type = ?, platform_name = ?, received_by = ?, shop_vendor_name = ?, purchased_by = ?,
        purchase_date = ?, asset_value = ?, invoice_photo = ?, asset_photo = ?
       WHERE id = ?`,
      [
        asset_name !== undefined ? asset_name : existing.asset_name,
        category || existing.category,
        type !== undefined ? type : existing.type,
        brand !== undefined ? brand : existing.brand,
        model !== undefined ? model : existing.model,
        serial_number !== undefined ? serial_number : existing.serial_number,
        operational_status || existing.operational_status,
        condition_status || existing.condition_status,
        assigned_to !== undefined ? (assigned_to || null) : existing.assigned_to,
        newPurchaseType,
        newPurchaseType === 'Online' ? (platform_name !== undefined ? platform_name : existing.platform_name) : null,
        newPurchaseType === 'Online' ? (received_by !== undefined ? received_by : existing.received_by) : null,
        newPurchaseType === 'Offline' ? (shop_vendor_name !== undefined ? shop_vendor_name : existing.shop_vendor_name) : null,
        newPurchaseType === 'Offline' ? (purchased_by !== undefined ? purchased_by : existing.purchased_by) : null,
        purchase_date || existing.purchase_date,
        asset_value !== undefined ? parseFloat(asset_value) : existing.asset_value,
        invoice_photo,
        asset_photo,
        req.params.id
      ]
    );

    // Track assignment change
    const newAssignedTo = assigned_to !== undefined ? (assigned_to || null) : existing.assigned_to;
    if (newAssignedTo && newAssignedTo != existing.assigned_to) {
      // Close previous assignment
      if (existing.assigned_to) {
        await db.query(
          `UPDATE asset_assignment_history SET returned_date = ? WHERE asset_id = ? AND assigned_to = ? AND returned_date IS NULL`,
          [new Date().toISOString().split('T')[0], req.params.id, existing.assigned_to]
        );
      }
      // Create new assignment record
      await db.query(
        `INSERT INTO asset_assignment_history (asset_id, assigned_to, assigned_by, assigned_date)
         VALUES (?, ?, ?, ?)`,
        [req.params.id, newAssignedTo, req.user.id, new Date().toISOString().split('T')[0]]
      );
    } else if (!newAssignedTo && existing.assigned_to) {
      // Asset unassigned — close previous
      await db.query(
        `UPDATE asset_assignment_history SET returned_date = ? WHERE asset_id = ? AND assigned_to = ? AND returned_date IS NULL`,
        [new Date().toISOString().split('T')[0], req.params.id, existing.assigned_to]
      );
    }

    const [updated] = await db.query(
      `SELECT a.*, CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM assets a
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       WHERE a.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Asset update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/assets/:id (soft delete) ─────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM assets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Asset not found' });

    await db.query('UPDATE assets SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Asset deleted' });
  } catch (err) {
    console.error('Asset delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/assets/:id/history ──────────────────────────────────────────────
exports.getHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT h.*,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(bu.first_name, ' ', bu.last_name) AS assigned_by_name
       FROM asset_assignment_history h
       LEFT JOIN users au ON au.id = h.assigned_to
       LEFT JOIN users bu ON bu.id = h.assigned_by
       WHERE h.asset_id = ?
       ORDER BY h.assigned_date DESC, h.created_at DESC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Asset history error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
