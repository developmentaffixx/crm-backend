const db = require('../config/db');

// ─── Helper: Check if user has inventory write access (admin only) ────────────
function canWrite(req) {
  return req.user && req.user.is_admin;
}

// ─── GET /api/inventories ─────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { category, search, low_stock, stock_status } = req.query;
    let where = 'inv.deleted = 0';
    const params = [];

    if (category) { where += ' AND inv.category = ?'; params.push(category); }
    if (search) {
      where += ' AND (inv.item_name LIKE ? OR inv.location LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [rows] = await db.query(
      `SELECT inv.*,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM inventories inv
       LEFT JOIN users cu ON cu.id = inv.created_by
       WHERE ${where}
       ORDER BY inv.category ASC, inv.item_name ASC`,
      params
    );

    // Apply stock-based filters after fetch (since quantity is the field)
    let filtered = rows;
    if (low_stock === 'true') {
      filtered = filtered.filter(r => r.min_stock_alert && r.quantity <= r.min_stock_alert);
    }
    if (stock_status === 'in_stock') {
      filtered = filtered.filter(r => r.quantity > 0);
    }
    if (stock_status === 'out_of_stock') {
      filtered = filtered.filter(r => r.quantity === 0);
    }

    const summary = {
      total_items: rows.filter(r => !r.deleted).length,
      total_value: rows.reduce((sum, r) => sum + parseFloat(r.total_value || 0), 0),
      low_stock_count: rows.filter(r => r.min_stock_alert && r.quantity <= r.min_stock_alert).length,
      out_of_stock_count: rows.filter(r => r.quantity === 0).length,
      categories: [...new Set(rows.map(r => r.category))].length,
    };

    return res.json({ inventories: filtered, summary });
  } catch (err) {
    console.error('Inventories list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/inventories/categories ──────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM inventory_categories WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Inventory categories error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/inventories/categories (Admin only) ────────────────────────────
exports.createCategory = async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ message: 'Admin access required' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required' });

    const [existing] = await db.query('SELECT id FROM inventory_categories WHERE name = ?', [name]);
    if (existing.length > 0) return res.status(409).json({ message: 'Category already exists' });

    const [maxOrder] = await db.query('SELECT MAX(sort_order) as max_order FROM inventory_categories');
    const nextOrder = (maxOrder[0].max_order || 0) + 1;

    const [result] = await db.query(
      'INSERT INTO inventory_categories (name, sort_order) VALUES (?, ?)',
      [name, nextOrder]
    );
    return res.status(201).json({ id: result.insertId, name, sort_order: nextOrder, is_active: 1 });
  } catch (err) {
    console.error('Create category error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/inventories/:id ─────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT inv.*,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM inventories inv
       LEFT JOIN users cu ON cu.id = inv.created_by
       WHERE inv.id = ? AND inv.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Inventory getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/inventories (Admin only) ───────────────────────────────────────
exports.create = async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ message: 'Admin access required' });

    const {
      item_name, category, unit, sku_code, quantity, unit_price,
      location, purchase_date, condition_status, assigned_to,
      serial_number, min_stock_alert, notes
    } = req.body;

    if (!item_name) return res.status(400).json({ message: 'Item name is required' });
    if (!category) return res.status(400).json({ message: 'Category is required' });

    const [result] = await db.query(
      `INSERT INTO inventories (
        item_name, category, unit, sku_code, quantity, unit_price,
        location, purchase_date, condition_status, assigned_to,
        serial_number, min_stock_alert, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item_name,
        category,
        unit || 'Nos',
        sku_code || null,
        parseInt(quantity || 0, 10),
        parseFloat(unit_price || 0),
        location || null,
        purchase_date || null,
        condition_status || 'New',
        assigned_to || null,
        serial_number || null,
        min_stock_alert || null,
        notes || null,
        req.user.id
      ]
    );

    // If initial quantity > 0, create an initial stock_in transaction
    const qty = parseInt(quantity || 0, 10);
    if (qty > 0) {
      await db.query(
        `INSERT INTO inventory_transactions (inventory_id, type, quantity, transaction_date, remarks, created_by)
         VALUES (?, 'stock_in', ?, CURDATE(), 'Initial stock', ?)`,
        [result.insertId, qty, req.user.id]
      );
    }

    const [created] = await db.query(
      `SELECT inv.*, CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM inventories inv
       LEFT JOIN users cu ON cu.id = inv.created_by
       WHERE inv.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Inventory create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/inventories/:id (Admin only) ────────────────────────────────────
exports.update = async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ message: 'Admin access required' });

    const [rows] = await db.query('SELECT * FROM inventories WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    const existing = rows[0];
    const {
      item_name, category, unit, sku_code, quantity, unit_price,
      location, purchase_date, condition_status, assigned_to,
      serial_number, min_stock_alert, notes
    } = req.body;

    await db.query(
      `UPDATE inventories SET
        item_name = ?, category = ?, unit = ?, sku_code = ?, quantity = ?, unit_price = ?,
        location = ?, purchase_date = ?, condition_status = ?, assigned_to = ?,
        serial_number = ?, min_stock_alert = ?, notes = ?
       WHERE id = ?`,
      [
        item_name !== undefined ? item_name : existing.item_name,
        category || existing.category,
        unit !== undefined ? unit : (existing.unit || 'Nos'),
        sku_code !== undefined ? sku_code : existing.sku_code,
        quantity !== undefined ? parseInt(quantity, 10) : existing.quantity,
        unit_price !== undefined ? parseFloat(unit_price) : existing.unit_price,
        location !== undefined ? location : existing.location,
        purchase_date !== undefined ? purchase_date : existing.purchase_date,
        condition_status || existing.condition_status,
        assigned_to !== undefined ? assigned_to : existing.assigned_to,
        serial_number !== undefined ? serial_number : existing.serial_number,
        min_stock_alert !== undefined ? min_stock_alert : existing.min_stock_alert,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT inv.*, CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM inventories inv
       LEFT JOIN users cu ON cu.id = inv.created_by
       WHERE inv.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Inventory update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/inventories/:id (Admin only, soft delete) ────────────────────
exports.remove = async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ message: 'Admin access required' });

    const [rows] = await db.query('SELECT * FROM inventories WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    await db.query('UPDATE inventories SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Inventory item deleted' });
  } catch (err) {
    console.error('Inventory delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/inventories/:id/stock-in (Admin only) ──────────────────────────
exports.stockIn = async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ message: 'Admin access required' });

    const { id } = req.params;
    const { quantity, transaction_date, vendor, bill_number, remarks } = req.body;

    if (!quantity || quantity <= 0) return res.status(400).json({ message: 'Quantity must be greater than 0' });

    const [rows] = await db.query('SELECT * FROM inventories WHERE id = ? AND deleted = 0', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    // Create transaction
    await db.query(
      `INSERT INTO inventory_transactions (inventory_id, type, quantity, transaction_date, vendor, bill_number, remarks, created_by)
       VALUES (?, 'stock_in', ?, ?, ?, ?, ?, ?)`,
      [id, parseInt(quantity, 10), transaction_date || new Date().toISOString().split('T')[0], vendor || null, bill_number || null, remarks || null, req.user.id]
    );

    // Update inventory quantity
    await db.query(
      'UPDATE inventories SET quantity = quantity + ?, purchase_date = ? WHERE id = ?',
      [parseInt(quantity, 10), transaction_date || new Date().toISOString().split('T')[0], id]
    );

    const [updated] = await db.query('SELECT * FROM inventories WHERE id = ?', [id]);
    return res.json({ message: 'Stock added successfully', item: updated[0] });
  } catch (err) {
    console.error('Stock in error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/inventories/:id/stock-out (Admin only) ─────────────────────────
exports.stockOut = async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ message: 'Admin access required' });

    const { id } = req.params;
    const { quantity, transaction_date, purpose, issued_by, remarks } = req.body;

    if (!quantity || quantity <= 0) return res.status(400).json({ message: 'Quantity must be greater than 0' });

    const [rows] = await db.query('SELECT * FROM inventories WHERE id = ? AND deleted = 0', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    if (rows[0].quantity < quantity) {
      return res.status(400).json({ message: `Insufficient stock. Available: ${rows[0].quantity}` });
    }

    // Create transaction
    await db.query(
      `INSERT INTO inventory_transactions (inventory_id, type, quantity, transaction_date, purpose, issued_by, remarks, created_by)
       VALUES (?, 'stock_out', ?, ?, ?, ?, ?, ?)`,
      [id, parseInt(quantity, 10), transaction_date || new Date().toISOString().split('T')[0], purpose || null, issued_by || null, remarks || null, req.user.id]
    );

    // Update inventory quantity
    await db.query(
      'UPDATE inventories SET quantity = quantity - ? WHERE id = ?',
      [parseInt(quantity, 10), id]
    );

    const [updated] = await db.query('SELECT * FROM inventories WHERE id = ?', [id]);
    return res.json({ message: 'Stock removed successfully', item: updated[0] });
  } catch (err) {
    console.error('Stock out error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/inventories/:id/history ─────────────────────────────────────────
exports.getHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT t.*,
              CONCAT(cb.first_name, ' ', cb.last_name) AS created_by_name,
              CONCAT(ib.first_name, ' ', ib.last_name) AS issued_by_name
       FROM inventory_transactions t
       LEFT JOIN users cb ON cb.id = t.created_by
       LEFT JOIN users ib ON ib.id = t.issued_by
       WHERE t.inventory_id = ?
       ORDER BY t.transaction_date DESC, t.created_at DESC`,
      [id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Inventory history error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/inventories/recent-transactions ─────────────────────────────────
exports.recentTransactions = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, inv.item_name, inv.category, inv.unit,
              CONCAT(cb.first_name, ' ', cb.last_name) AS created_by_name
       FROM inventory_transactions t
       JOIN inventories inv ON inv.id = t.inventory_id
       LEFT JOIN users cb ON cb.id = t.created_by
       ORDER BY t.created_at DESC
       LIMIT 20`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Recent transactions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
