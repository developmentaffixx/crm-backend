const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

// ─── Helper: Generate next asset ID ──────────────────────────────────────────
async function generateAssetId() {
  const [rows] = await db.query(
    `SELECT asset_id FROM assets ORDER BY id DESC LIMIT 1`
  );
  if (rows.length === 0) return 'AST-001';
  const last = rows[0].asset_id; // e.g. AST-014
  const num = parseInt(last.split('-')[1], 10) + 1;
  return `AST-${String(num).padStart(3, '0')}`;
}

// ─── Helper: Upload file to Cloudinary ───────────────────────────────────────
async function saveFile(file, folder) {
  const { url } = await uploadToCloudinary(file.buffer, `crm/assets/${folder}`, 'auto');
  return url;
}

// ─── GET /api/assets/categories ───────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM asset_categories WHERE is_active = 1 ORDER BY name ASC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Asset categories error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/assets/categories ──────────────────────────────────────────────
exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }
    const [existing] = await db.query('SELECT id FROM asset_categories WHERE name = ?', [name.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Category already exists' });
    }
    const [result] = await db.query(
      'INSERT INTO asset_categories (name, description) VALUES (?, ?)',
      [name.trim(), description || null]
    );
    return res.status(201).json({ id: result.insertId, name: name.trim(), description: description || null });
  } catch (err) {
    console.error('Create category error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/assets/categories/:id ────────────────────────────────────────
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    // Check if any assets use this category
    const [used] = await db.query('SELECT COUNT(*) as count FROM assets WHERE category_id = ? AND deleted = 0', [id]);
    if (used[0].count > 0) {
      return res.status(400).json({ message: 'Cannot delete category that has assets assigned to it' });
    }
    await db.query('UPDATE asset_categories SET is_active = 0 WHERE id = ?', [id]);
    return res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('Delete category error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/assets ──────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, condition_status, category_id, assigned_to, location, search } = req.query;
    let where = 'a.deleted = 0';
    const params = [];

    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (condition_status) { where += ' AND a.condition_status = ?'; params.push(condition_status); }
    if (category_id) { where += ' AND a.category_id = ?'; params.push(category_id); }
    if (assigned_to) { where += ' AND a.assigned_to = ?'; params.push(assigned_to); }
    if (location) { where += ' AND a.location LIKE ?'; params.push(`%${location}%`); }
    if (search) {
      where += ' AND (a.asset_name LIKE ? OR a.asset_id LIKE ? OR a.serial_number LIKE ? OR a.brand LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [rows] = await db.query(
      `SELECT a.*,
              c.name AS category_name,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name,
              CONCAT(ru.first_name, ' ', ru.last_name) AS received_by_name,
              CONCAT(pu.first_name, ' ', pu.last_name) AS purchased_by_name
       FROM assets a
       LEFT JOIN asset_categories c ON c.id = a.category_id
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       LEFT JOIN users ru ON ru.id = a.received_by
       LEFT JOIN users pu ON pu.id = a.purchased_by
       WHERE ${where}
       ORDER BY a.created_at DESC`,
      params
    );

    const summary = {
      total: rows.length,
      available: rows.filter(r => r.status === 'Available').length,
      assigned: rows.filter(r => r.status === 'Assigned').length,
      in_use: rows.filter(r => r.status === 'In Use').length,
      under_maintenance: rows.filter(r => r.status === 'Under Maintenance').length,
      returned: rows.filter(r => r.status === 'Returned').length,
      retired: rows.filter(r => r.status === 'Retired').length,
      disposed: rows.filter(r => r.status === 'Disposed').length,
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
              c.name AS category_name,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name,
              CONCAT(ru.first_name, ' ', ru.last_name) AS received_by_name,
              CONCAT(pu.first_name, ' ', pu.last_name) AS purchased_by_name
       FROM assets a
       LEFT JOIN asset_categories c ON c.id = a.category_id
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       LEFT JOIN users ru ON ru.id = a.received_by
       LEFT JOIN users pu ON pu.id = a.purchased_by
       WHERE a.id = ? AND a.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Asset not found' });

    // Get components
    const [components] = await db.query(
      'SELECT * FROM asset_components WHERE asset_id = ? ORDER BY id ASC',
      [req.params.id]
    );

    return res.json({ ...rows[0], components });
  } catch (err) {
    console.error('Asset getOne error:', err);
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

// ─── GET /api/assets/:id/components ───────────────────────────────────────────
exports.getComponents = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM asset_components WHERE asset_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Asset components error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/assets ─────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      asset_name, category_id, brand, model, serial_number,
      purchase_date, purchase_cost, warranty_expiry,
      assigned_to, location, status, condition_status, notes,
      purchase_type, platform_name, received_by, shop_vendor_name, purchased_by,
      asset_value
    } = req.body;

    // Components come as JSON string from FormData
    let components = req.body.components;
    if (typeof components === 'string') {
      try { components = JSON.parse(components); } catch { components = []; }
    }

    if (!asset_name) return res.status(400).json({ message: 'Asset name is required' });
    if (!category_id) return res.status(400).json({ message: 'Category is required' });

    const asset_id = await generateAssetId();

    // Handle file uploads
    let invoice_photo = null;
    let asset_photo = null;
    if (req.files) {
      if (req.files.invoice_photo && req.files.invoice_photo[0]) {
        invoice_photo = await saveFile(req.files.invoice_photo[0], 'invoices');
      }
      if (req.files.asset_photo && req.files.asset_photo[0]) {
        asset_photo = await saveFile(req.files.asset_photo[0], 'photos');
      }
    }

    const [result] = await db.query(
      `INSERT INTO assets (
        asset_id, asset_name, category_id, brand, model, serial_number,
        purchase_date, purchase_cost, warranty_expiry,
        assigned_to, location, status, condition_status, notes,
        purchase_type, platform_name, received_by, shop_vendor_name, purchased_by,
        asset_value, invoice_photo, asset_photo, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset_id,
        asset_name,
        category_id,
        brand || null,
        model || null,
        serial_number || null,
        purchase_date || null,
        purchase_cost ? parseFloat(purchase_cost) : null,
        warranty_expiry || null,
        assigned_to || null,
        location || null,
        status || 'Available',
        condition_status || 'Working',
        notes || null,
        purchase_type || null,
        purchase_type === 'Online' ? (platform_name || null) : null,
        purchase_type === 'Online' ? (received_by || null) : null,
        purchase_type === 'Offline' ? (shop_vendor_name || null) : null,
        purchase_type === 'Offline' ? (purchased_by || null) : null,
        parseFloat(asset_value || 0),
        invoice_photo,
        asset_photo,
        req.user.id
      ]
    );

    const newAssetId = result.insertId;

    // Insert components if provided
    if (components && Array.isArray(components) && components.length > 0) {
      const compValues = components
        .filter(c => c.item_name && c.item_name.trim())
        .map(c => [newAssetId, c.item_name.trim(), parseInt(c.quantity) || 1, c.notes || null]);
      if (compValues.length > 0) {
        await db.query(
          'INSERT INTO asset_components (asset_id, item_name, quantity, notes) VALUES ?',
          [compValues]
        );
      }
    }

    // If assigned_to is set, create assignment history
    if (assigned_to) {
      await db.query(
        `INSERT INTO asset_assignment_history (asset_id, assigned_to, assigned_by, assigned_date)
         VALUES (?, ?, ?, ?)`,
        [newAssetId, assigned_to, req.user.id, new Date().toISOString().split('T')[0]]
      );
    }

    // Return created asset
    const [created] = await db.query(
      `SELECT a.*, c.name AS category_name,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM assets a
       LEFT JOIN asset_categories c ON c.id = a.category_id
       LEFT JOIN users au ON au.id = a.assigned_to
       LEFT JOIN users cu ON cu.id = a.created_by
       WHERE a.id = ?`,
      [newAssetId]
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
      asset_name, category_id, brand, model, serial_number,
      purchase_date, purchase_cost, warranty_expiry,
      assigned_to, location, status, condition_status, notes,
      purchase_type, platform_name, received_by, shop_vendor_name, purchased_by,
      asset_value
    } = req.body;

    // Components come as JSON string from FormData
    let components = req.body.components;
    if (typeof components === 'string') {
      try { components = JSON.parse(components); } catch { components = undefined; }
    }

    // Handle file uploads
    let invoice_photo = existing.invoice_photo;
    let asset_photo = existing.asset_photo;
    if (req.files) {
      if (req.files.invoice_photo && req.files.invoice_photo[0]) {
        if (existing.invoice_photo) {
          const oldId = extractPublicId(existing.invoice_photo);
          if (oldId) await deleteFromCloudinary(oldId, 'raw');
        }
        invoice_photo = await saveFile(req.files.invoice_photo[0], 'invoices');
      }
      if (req.files.asset_photo && req.files.asset_photo[0]) {
        if (existing.asset_photo) {
          const oldId = extractPublicId(existing.asset_photo);
          if (oldId) await deleteFromCloudinary(oldId, 'image');
        }
        asset_photo = await saveFile(req.files.asset_photo[0], 'photos');
      }
    }

    const newPurchaseType = purchase_type !== undefined ? purchase_type : existing.purchase_type;

    await db.query(
      `UPDATE assets SET
        asset_name = ?, category_id = ?, brand = ?, model = ?, serial_number = ?,
        purchase_date = ?, purchase_cost = ?, warranty_expiry = ?,
        assigned_to = ?, location = ?, status = ?, condition_status = ?, notes = ?,
        purchase_type = ?, platform_name = ?, received_by = ?, shop_vendor_name = ?, purchased_by = ?,
        asset_value = ?, invoice_photo = ?, asset_photo = ?
       WHERE id = ?`,
      [
        asset_name !== undefined ? asset_name : existing.asset_name,
        category_id || existing.category_id,
        brand !== undefined ? brand : existing.brand,
        model !== undefined ? model : existing.model,
        serial_number !== undefined ? serial_number : existing.serial_number,
        purchase_date || existing.purchase_date,
        purchase_cost !== undefined ? (purchase_cost ? parseFloat(purchase_cost) : null) : existing.purchase_cost,
        warranty_expiry !== undefined ? (warranty_expiry || null) : existing.warranty_expiry,
        assigned_to !== undefined ? (assigned_to || null) : existing.assigned_to,
        location !== undefined ? location : existing.location,
        status || existing.status,
        condition_status || existing.condition_status,
        notes !== undefined ? notes : existing.notes,
        newPurchaseType,
        newPurchaseType === 'Online' ? (platform_name !== undefined ? platform_name : existing.platform_name) : null,
        newPurchaseType === 'Online' ? (received_by !== undefined ? received_by : existing.received_by) : null,
        newPurchaseType === 'Offline' ? (shop_vendor_name !== undefined ? shop_vendor_name : existing.shop_vendor_name) : null,
        newPurchaseType === 'Offline' ? (purchased_by !== undefined ? purchased_by : existing.purchased_by) : null,
        asset_value !== undefined ? parseFloat(asset_value) : existing.asset_value,
        invoice_photo,
        asset_photo,
        req.params.id
      ]
    );

    // Update components if provided
    if (components !== undefined && Array.isArray(components)) {
      // Delete existing and re-insert
      await db.query('DELETE FROM asset_components WHERE asset_id = ?', [req.params.id]);
      const compValues = components
        .filter(c => c.item_name && c.item_name.trim())
        .map(c => [req.params.id, c.item_name.trim(), parseInt(c.quantity) || 1, c.notes || null]);
      if (compValues.length > 0) {
        await db.query(
          'INSERT INTO asset_components (asset_id, item_name, quantity, notes) VALUES ?',
          [compValues]
        );
      }
    }

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

    // Return updated asset
    const [updated] = await db.query(
      `SELECT a.*, c.name AS category_name,
              CONCAT(au.first_name, ' ', au.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM assets a
       LEFT JOIN asset_categories c ON c.id = a.category_id
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

// ─── POST /api/assets/:id/assign ──────────────────────────────────────────────
exports.assign = async (req, res) => {
  try {
    const { assigned_to, remarks } = req.body;
    if (!assigned_to) return res.status(400).json({ message: 'Employee is required' });

    const [rows] = await db.query('SELECT * FROM assets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Asset not found' });

    const existing = rows[0];

    // Close previous assignment if exists
    if (existing.assigned_to) {
      await db.query(
        `UPDATE asset_assignment_history SET returned_date = ? WHERE asset_id = ? AND assigned_to = ? AND returned_date IS NULL`,
        [new Date().toISOString().split('T')[0], req.params.id, existing.assigned_to]
      );
    }

    // Update asset
    await db.query(
      'UPDATE assets SET assigned_to = ?, status = ? WHERE id = ?',
      [assigned_to, 'Assigned', req.params.id]
    );

    // Create assignment record
    await db.query(
      `INSERT INTO asset_assignment_history (asset_id, assigned_to, assigned_by, assigned_date, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, assigned_to, req.user.id, new Date().toISOString().split('T')[0], remarks || null]
    );

    return res.json({ message: 'Asset assigned successfully' });
  } catch (err) {
    console.error('Asset assign error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/assets/:id/return ──────────────────────────────────────────────
exports.returnAsset = async (req, res) => {
  try {
    const { remarks } = req.body;

    const [rows] = await db.query('SELECT * FROM assets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Asset not found' });

    const existing = rows[0];
    if (!existing.assigned_to) {
      return res.status(400).json({ message: 'Asset is not currently assigned' });
    }

    // Close current assignment
    await db.query(
      `UPDATE asset_assignment_history SET returned_date = ?, remarks = CONCAT(IFNULL(remarks, ''), ?) 
       WHERE asset_id = ? AND assigned_to = ? AND returned_date IS NULL`,
      [
        new Date().toISOString().split('T')[0],
        remarks ? (remarks) : '',
        req.params.id,
        existing.assigned_to
      ]
    );

    // Update asset
    await db.query(
      'UPDATE assets SET assigned_to = NULL, status = ? WHERE id = ?',
      ['Available', req.params.id]
    );

    return res.json({ message: 'Asset returned successfully' });
  } catch (err) {
    console.error('Asset return error:', err);
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

// ─── POST /api/assets/:id/components ──────────────────────────────────────────
exports.addComponent = async (req, res) => {
  try {
    const { item_name, quantity, notes } = req.body;
    if (!item_name || !item_name.trim()) {
      return res.status(400).json({ message: 'Item name is required' });
    }

    const [asset] = await db.query('SELECT id FROM assets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (asset.length === 0) return res.status(404).json({ message: 'Asset not found' });

    const [result] = await db.query(
      'INSERT INTO asset_components (asset_id, item_name, quantity, notes) VALUES (?, ?, ?, ?)',
      [req.params.id, item_name.trim(), parseInt(quantity) || 1, notes || null]
    );

    return res.status(201).json({ id: result.insertId, asset_id: parseInt(req.params.id), item_name: item_name.trim(), quantity: parseInt(quantity) || 1, notes: notes || null });
  } catch (err) {
    console.error('Add component error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/assets/:id/components/:componentId ───────────────────────────
exports.removeComponent = async (req, res) => {
  try {
    const { id, componentId } = req.params;
    await db.query('DELETE FROM asset_components WHERE id = ? AND asset_id = ?', [componentId, id]);
    return res.json({ message: 'Component removed' });
  } catch (err) {
    console.error('Remove component error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
