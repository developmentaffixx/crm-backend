const db = require('../config/db');

/**
 * GET /api/clients
 * Returns all leads with status = 'Won' (i.e. converted clients)
 */
exports.list = async (req, res) => {
  try {
    const { search } = req.query;
    let where = "l.deleted = 0 AND l.status = 'Won'";
    const params = [];

    if (search) {
      where += ' AND (l.name LIKE ? OR l.business_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    // Non-admin: only see clients assigned to or created by them
    if (!req.user.is_admin) {
      where += ' AND (l.assigned_to = ? OR l.created_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE ${where}
       ORDER BY l.updated_at DESC`,
      params
    );

    return res.json({ clients: rows, total: rows.length });
  } catch (err) {
    console.error('Clients list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/clients/:id
 * Returns full client detail with related projects, invoices, follow-ups
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name
       FROM leads l
       LEFT JOIN users u_assigned ON u_assigned.id = l.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = l.created_by
       WHERE l.id = ? AND l.deleted = 0 AND l.status = 'Won'`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Client not found' });

    const client = rows[0];

    // Non-admin access check
    if (!req.user.is_admin && client.assigned_to !== req.user.id && client.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch social links
    const [links] = await db.query('SELECT * FROM lead_social_links WHERE lead_id = ?', [client.id]);
    client.social_links = links;

    // Fetch follow-ups
    const [followUps] = await db.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.lead_id = ?
       ORDER BY f.created_at DESC`,
      [client.id]
    );
    client.follow_ups = followUps;

    // Fetch related projects
    const [projects] = await db.query(
      `SELECT p.id, p.title, p.status, p.start_date, p.end_date, p.project_type
       FROM projects p
       WHERE p.client_id = ? AND p.deleted = 0
       ORDER BY p.created_at DESC`,
      [client.id]
    );
    client.projects = projects;

    // Fetch related invoices
    const [invoices] = await db.query(
      `SELECT i.id, i.invoice_number, i.status, i.bill_date, i.due_date, i.total_amount, i.paid_amount, i.balance_amount
       FROM invoices i
       WHERE i.lead_id = ? AND i.deleted = 0
       ORDER BY i.created_at DESC`,
      [client.id]
    );
    client.invoices = invoices;

    return res.json(client);
  } catch (err) {
    console.error('Client getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
