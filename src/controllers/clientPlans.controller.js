const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT PLANS - Assign/manage plans for clients
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/client-plans/client/:clientId
 * Get all plans assigned to a specific client
 */
exports.getClientPlans = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cp.*,
              p.name AS plan_name, p.price AS plan_price, p.duration AS plan_duration,
              s.name AS service_name, s.icon AS service_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_plans cp
       INNER JOIN plans p ON p.id = cp.plan_id
       INNER JOIN services s ON s.id = cp.service_id
       LEFT JOIN users u ON u.id = cp.created_by
       WHERE cp.client_id = ?
       ORDER BY cp.status = 'active' DESC, cp.start_date DESC`,
      [req.params.clientId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get client plans error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-plans
 * Assign a plan to a client
 */
exports.assignPlan = async (req, res) => {
  try {
    const { client_id, plan_id, service_id, start_date, end_date, amount, notes } = req.body;

    if (!client_id || !plan_id || !service_id || !start_date) {
      return res.status(400).json({ message: 'client_id, plan_id, service_id, and start_date are required' });
    }

    const [result] = await db.query(
      `INSERT INTO client_plans (client_id, plan_id, service_id, start_date, end_date, amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id, plan_id, service_id, start_date, end_date || null, amount || 0, notes || null, req.user.id]
    );

    const [row] = await db.query(
      `SELECT cp.*,
              p.name AS plan_name, p.price AS plan_price, p.duration AS plan_duration,
              s.name AS service_name, s.icon AS service_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_plans cp
       INNER JOIN plans p ON p.id = cp.plan_id
       INNER JOIN services s ON s.id = cp.service_id
       LEFT JOIN users u ON u.id = cp.created_by
       WHERE cp.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(row[0]);
  } catch (err) {
    console.error('Assign plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-plans/:id
 * Update a client plan assignment (status, dates, amount)
 */
exports.updateClientPlan = async (req, res) => {
  try {
    const { status, start_date, end_date, amount, notes } = req.body;
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date || null;
    if (amount !== undefined) updates.amount = amount;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE client_plans SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const [row] = await db.query(
      `SELECT cp.*,
              p.name AS plan_name, p.price AS plan_price, p.duration AS plan_duration,
              s.name AS service_name, s.icon AS service_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM client_plans cp
       INNER JOIN plans p ON p.id = cp.plan_id
       INNER JOIN services s ON s.id = cp.service_id
       LEFT JOIN users u ON u.id = cp.created_by
       WHERE cp.id = ?`,
      [req.params.id]
    );

    if (row.length === 0) return res.status(404).json({ message: 'Client plan not found' });
    return res.json(row[0]);
  } catch (err) {
    console.error('Update client plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/client-plans/:id
 * Remove a plan assignment from a client
 */
exports.deleteClientPlan = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT id FROM client_plans WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Client plan not found' });

    await db.query('DELETE FROM client_plans WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Plan assignment removed' });
  } catch (err) {
    console.error('Delete client plan error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-plans/plan/:planId/subscribers
 * Get all clients subscribed to a specific plan
 */
exports.getPlanSubscribers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cp.*,
              l.name AS client_name, l.business_name, l.email AS client_email, l.phone AS client_phone,
              p.name AS plan_name, p.price AS plan_price, p.duration AS plan_duration,
              s.name AS service_name, s.icon AS service_icon
       FROM client_plans cp
       INNER JOIN leads l ON l.id = cp.client_id
       INNER JOIN plans p ON p.id = cp.plan_id
       INNER JOIN services s ON s.id = cp.service_id
       WHERE cp.plan_id = ?
       ORDER BY cp.status = 'active' DESC, cp.start_date DESC`,
      [req.params.planId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get plan subscribers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-plans/analytics
 * Get plan analytics - popularity, growth, revenue per plan
 */
exports.getAnalytics = async (req, res) => {
  try {
    // Plan popularity (active subscribers count + total revenue)
    const [popularity] = await db.query(
      `SELECT p.id AS plan_id, p.name AS plan_name, p.price AS plan_price, p.duration AS plan_duration,
              s.id AS service_id, s.name AS service_name, s.icon AS service_icon,
              COUNT(cp.id) AS total_subscribers,
              SUM(CASE WHEN cp.status = 'active' THEN 1 ELSE 0 END) AS active_subscribers,
              COALESCE(SUM(cp.amount), 0) AS total_revenue
       FROM plans p
       INNER JOIN services s ON s.id = p.service_id
       LEFT JOIN client_plans cp ON cp.plan_id = p.id
       WHERE p.deleted = 0
       GROUP BY p.id, p.name, p.price, p.duration, s.id, s.name, s.icon
       ORDER BY active_subscribers DESC, total_revenue DESC`
    );

    // Monthly growth (subscriptions per month for last 6 months)
    const [growth] = await db.query(
      `SELECT 
         DATE_FORMAT(cp.start_date, '%Y-%m') AS month,
         p.name AS plan_name,
         p.id AS plan_id,
         COUNT(*) AS new_subscriptions
       FROM client_plans cp
       INNER JOIN plans p ON p.id = cp.plan_id
       WHERE cp.start_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY month, p.id, p.name
       ORDER BY month ASC, new_subscriptions DESC`
    );

    // Overall stats
    const [stats] = await db.query(
      `SELECT 
         COUNT(*) AS total_assignments,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
         SUM(CASE WHEN status = 'upgraded' THEN 1 ELSE 0 END) AS upgraded_count,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count,
         COALESCE(SUM(amount), 0) AS total_revenue
       FROM client_plans`
    );

    return res.json({
      popularity,
      growth,
      stats: stats[0] || {},
    });
  } catch (err) {
    console.error('Plan analytics error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
