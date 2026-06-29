const db = require('../config/db');

const JSON_FIELDS = ['highlights','kpi_performance','social_performance','content_performance','content_distribution','community_management','lead_generation','ads_performance','competitor_insights','what_worked','challenges_faced','recommendations','next_month_plan','client_feedback','renewal_review','internal_review','report_approval','performance_summary'];

function parseJsonFields(row) {
  JSON_FIELDS.forEach(f => {
    if (row[f] && typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch(e) {}
    }
  });
  return row;
}

// ─── LIST ────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { project_id, status, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (project_id) { where += ' AND mr.project_id = ?'; params.push(project_id); }
    if (status) { where += ' AND mr.status = ?'; params.push(status); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [rows] = await db.query(
      `SELECT mr.id, mr.project_id, mr.reporting_month, mr.report_date, mr.status, mr.created_at,
              p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE ${where}
       ORDER BY mr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM smm_monthly_reports mr WHERE ${where}`, params);
    return res.json({ reports: rows, total: countResult[0].total });
  } catch (err) {
    console.error('Monthly report list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mr.*, p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });
    return res.json(parseJsonFields(rows[0]));
  } catch (err) {
    console.error('Monthly report getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { project_id, reporting_month } = req.body;
    if (!project_id || !reporting_month) return res.status(400).json({ message: 'Project and reporting month are required' });

    const data = { project_id, reporting_month, created_by: req.user.id };
    const fields = ['reporting_period','report_version','report_date','executive_summary','status'];
    fields.forEach(f => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    JSON_FIELDS.forEach(f => { if (req.body[f] !== undefined) data[f] = JSON.stringify(req.body[f]); });

    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const [result] = await db.query(`INSERT INTO smm_monthly_reports (${columns}) VALUES (${placeholders})`, Object.values(data));

    const [report] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [result.insertId]);
    res.emitSocket('monthly-report:created', { id: result.insertId });
    return res.status(201).json(parseJsonFields(report[0]));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A report already exists for this project and month.' });
    console.error('Monthly report create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updates = {};
    const textFields = ['reporting_period','report_version','report_date','executive_summary','status'];
    textFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    JSON_FIELDS.forEach(f => { if (req.body[f] !== undefined) updates[f] = JSON.stringify(req.body[f]); });

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.query(`UPDATE smm_monthly_reports SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    }

    const [updated] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    res.emitSocket('monthly-report:updated', { id: parseInt(req.params.id) });
    return res.json(parseJsonFields(updated[0]));
  } catch (err) {
    console.error('Monthly report update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('DELETE FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    res.emitSocket('monthly-report:deleted', { id: parseInt(req.params.id) });
    return res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('Monthly report delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
