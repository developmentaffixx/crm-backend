const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/services — list all services for a project
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const projectId = req.params.projectId;

    const [rows] = await db.query(
      `SELECT ps.*,
              s.name AS service_name,
              s.icon AS service_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM service_cycles sc WHERE sc.project_service_id = ps.id) AS cycle_count,
              (SELECT MAX(sc.cycle_number) FROM service_cycles sc WHERE sc.project_service_id = ps.id) AS latest_cycle_number,
              (SELECT sc.status FROM service_cycles sc WHERE sc.project_service_id = ps.id ORDER BY sc.cycle_number DESC LIMIT 1) AS latest_cycle_status
       FROM project_services ps
       JOIN services s ON s.id = ps.service_id
       LEFT JOIN users u ON u.id = ps.created_by
       WHERE ps.project_id = ?
       ORDER BY ps.created_at ASC`,
      [projectId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Project services list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/services — add a service to a project
// ─────────────────────────────────────────────────────────────────────────────
exports.add = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const projectId = req.params.projectId;
    const { service_id, start_date, end_date, notes } = req.body;

    // Verify project exists
    const [project] = await db.query(
      'SELECT id, start_date FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check if service already exists for this project
    const [existing] = await db.query(
      'SELECT id FROM project_services WHERE project_id = ? AND service_id = ?',
      [projectId, service_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'This service is already added to the project' });
    }

    const [result] = await db.query(
      `INSERT INTO project_services (project_id, service_id, start_date, end_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, service_id, start_date || project[0].start_date, end_date || null, notes || null, req.user.id]
    );

    const [newRow] = await db.query(
      `SELECT ps.*, s.name AS service_name, s.icon AS service_icon
       FROM project_services ps
       JOIN services s ON s.id = ps.service_id
       WHERE ps.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(newRow[0]);
  } catch (err) {
    console.error('Project services add error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This service is already added to the project' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:projectId/services/:serviceId — update a project service
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;
    const { start_date, end_date, status, notes } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM project_services WHERE id = ? AND project_id = ?',
      [serviceId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }

    const updates = {};
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_date !== undefined) updates.end_date = end_date;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE project_services SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), serviceId]
    );

    const [updated] = await db.query(
      `SELECT ps.*, s.name AS service_name, s.icon AS service_icon
       FROM project_services ps
       JOIN services s ON s.id = ps.service_id
       WHERE ps.id = ?`,
      [serviceId]
    );

    return res.json(updated[0]);
  } catch (err) {
    console.error('Project services update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/services/:serviceId — remove a service from project
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;

    const [existing] = await db.query(
      'SELECT id FROM project_services WHERE id = ? AND project_id = ?',
      [serviceId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }

    // This will cascade-delete related cycles via FK
    await db.query('DELETE FROM project_services WHERE id = ?', [serviceId]);

    return res.json({ message: 'Service removed from project' });
  } catch (err) {
    console.error('Project services remove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/services/:serviceId — get single service detail
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;

    const [rows] = await db.query(
      `SELECT ps.*,
              s.name AS service_name,
              s.icon AS service_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              p.title AS project_title,
              p.client_id,
              l.business_name AS client_name
       FROM project_services ps
       JOIN services s ON s.id = ps.service_id
       JOIN projects p ON p.id = ps.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = ps.created_by
       WHERE ps.id = ? AND ps.project_id = ?`,
      [serviceId, projectId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Project services getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
