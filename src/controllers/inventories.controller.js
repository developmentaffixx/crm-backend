const db = require('../config/db');

// ─── GET /api/inventories ─────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { category, condition_status, search, low_stock } = req.query;
    let where = 'inv.deleted = 0';
    const params = [];

    if (category) { where += ' AND inv.category = ?'; params.push(category); }
    if (condition_status) { where += ' AND inv.condition_status = ?'; params.push(condition_status); }
    if (low_stock === 'true') { where += ' AND inv.min_stock_alert IS NOT NULL AND inv.quantity <= inv.min_stock_alert'; }
    if (search) {
      where += ' AND (inv.item_name LIKE ? OR inv.sku_code LIKE ? OR inv.location LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT inv.*,
              CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM inventories inv
       LEFT JOIN users cu ON cu.id = inv.created_by
       WHERE ${where}
       ORDER BY inv.created_at DESC`,
      params
    );

    const summary = {
      total_items: rows.length,
      total_value: rows.reduce((sum, r) => sum + parseFloat(r.total_value || 0), 0),
      low_stock_count: rows.filter(r => r.min_stock_alert && r.quantity <= r.min_stock_alert).length,
      categories: [...new Set(rows.map(r => r.category))].length,
    };

    return res.json({ inventories: rows, summary });
  } catch (err) {
    console.error('Inventories list error:', err);
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

// ─── POST /api/inventories ────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      item_name, category, sku_code, quantity, unit_price,
      location, purchase_date, condition_status, assigned_to,
      serial_number, min_stock_alert, notes
    } = req.body;

    if (!item_name) return res.status(400).json({ message: 'Item name is required' });
    if (!category) return res.status(400).json({ message: 'Category is required' });
    if (quantity === undefined || quantity === null) return res.status(400).json({ message: 'Quantity is required' });
    if (!unit_price && unit_price !== 0) return res.status(400).json({ message: 'Unit price is required' });

    const [result] = await db.query(
      `INSERT INTO inventories (
        item_name, category, sku_code, quantity, unit_price,
        location, purchase_date, condition_status, assigned_to,
        serial_number, min_stock_alert, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item_name,
        category,
        sku_code || null,
        parseInt(quantity, 10),
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

// ─── PUT /api/inventories/:id ─────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM inventories WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    const existing = rows[0];
    const {
      item_name, category, sku_code, quantity, unit_price,
      location, purchase_date, condition_status, assigned_to,
      serial_number, min_stock_alert, notes
    } = req.body;

    await db.query(
      `UPDATE inventories SET
        item_name = ?, category = ?, sku_code = ?, quantity = ?, unit_price = ?,
        location = ?, purchase_date = ?, condition_status = ?, assigned_to = ?,
        serial_number = ?, min_stock_alert = ?, notes = ?
       WHERE id = ?`,
      [
        item_name !== undefined ? item_name : existing.item_name,
        category || existing.category,
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

// ─── DELETE /api/inventories/:id (soft delete) ────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM inventories WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Inventory item not found' });

    await db.query('UPDATE inventories SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Inventory item deleted' });
  } catch (err) {
    console.error('Inventory delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
