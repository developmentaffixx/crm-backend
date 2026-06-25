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
              s.service_type,
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
              s.service_type,
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/services/:serviceId/pause — pause a service
// ─────────────────────────────────────────────────────────────────────────────
exports.pauseService = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Reason is required to pause a service' });
    }

    const [existing] = await db.query(
      'SELECT * FROM project_services WHERE id = ? AND project_id = ?',
      [serviceId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }
    if (existing[0].status !== 'active') {
      return res.status(400).json({ message: 'Only active services can be paused' });
    }

    // Update service status
    await db.query(
      'UPDATE project_services SET status = ?, notes = ? WHERE id = ?',
      ['paused', reason.trim(), serviceId]
    );

    // Pause the active cycle if any
    await db.query(
      `UPDATE service_cycles SET status = 'paused' WHERE project_service_id = ? AND status = 'active'`,
      [serviceId]
    );

    // Log the action
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'update', ?, ?)`,
      [projectId, `Service paused: ${reason.trim()}`, req.user.id]
    );

    return res.json({ message: 'Service paused successfully' });
  } catch (err) {
    console.error('Pause service error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/services/:serviceId/complete — complete a service
// ─────────────────────────────────────────────────────────────────────────────
exports.completeService = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Reason is required to complete a service' });
    }

    const [existing] = await db.query(
      'SELECT * FROM project_services WHERE id = ? AND project_id = ?',
      [serviceId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }
    if (existing[0].status === 'completed') {
      return res.status(400).json({ message: 'Service is already completed' });
    }

    // Update service status
    await db.query(
      'UPDATE project_services SET status = ?, notes = ? WHERE id = ?',
      ['completed', reason.trim(), serviceId]
    );

    // Complete the active/paused cycle if any
    await db.query(
      `UPDATE service_cycles SET status = 'completed' WHERE project_service_id = ? AND status IN ('active', 'paused')`,
      [serviceId]
    );

    // Log the action
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'milestone', ?, ?)`,
      [projectId, `Service completed: ${reason.trim()}`, req.user.id]
    );

    return res.json({ message: 'Service completed successfully' });
  } catch (err) {
    console.error('Complete service error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/services/:serviceId/cancel — cancel a service
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelService = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Reason is required to cancel a service' });
    }

    const [existing] = await db.query(
      'SELECT * FROM project_services WHERE id = ? AND project_id = ?',
      [serviceId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }
    if (existing[0].status === 'cancelled') {
      return res.status(400).json({ message: 'Service is already cancelled' });
    }

    // Update service status
    await db.query(
      'UPDATE project_services SET status = ?, notes = ? WHERE id = ?',
      ['cancelled', reason.trim(), serviceId]
    );

    // Skip the active/paused cycle if any
    await db.query(
      `UPDATE service_cycles SET status = 'skipped' WHERE project_service_id = ? AND status IN ('active', 'paused')`,
      [serviceId]
    );

    // Log the action
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'issue', ?, ?)`,
      [projectId, `Service cancelled: ${reason.trim()}`, req.user.id]
    );

    return res.json({ message: 'Service cancelled successfully' });
  } catch (err) {
    console.error('Cancel service error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/services/:serviceId/new-cycle — create new cycle (reactivates service)
// ─────────────────────────────────────────────────────────────────────────────
exports.createNewCycle = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;

    const [existing] = await db.query(
      `SELECT ps.*, s.service_type
       FROM project_services ps
       JOIN services s ON s.id = ps.service_id
       WHERE ps.id = ? AND ps.project_id = ?`,
      [serviceId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Project service not found' });
    }

    // Block new cycle creation for one-time services that already have a cycle
    if (existing[0].service_type === 'one_time') {
      const [existingCycles] = await db.query(
        `SELECT id FROM service_cycles WHERE project_service_id = ? LIMIT 1`,
        [serviceId]
      );
      if (existingCycles.length > 0) {
        return res.status(400).json({ message: 'This is a one-time service. It does not support multiple cycles.' });
      }
    }

    // Check no active cycle already exists
    const [activeCycles] = await db.query(
      `SELECT id FROM service_cycles WHERE project_service_id = ? AND status = 'active' LIMIT 1`,
      [serviceId]
    );
    if (activeCycles.length > 0) {
      return res.status(400).json({ message: 'An active cycle already exists for this service' });
    }

    // Determine start date for new cycle
    const startDate = existing[0].start_date || new Date().toISOString().split('T')[0];

    // Get max cycle number
    const [maxRow] = await db.query(
      'SELECT MAX(cycle_number) AS max_num FROM service_cycles WHERE project_service_id = ?',
      [serviceId]
    );
    const nextCycleNum = (maxRow[0].max_num || 0) + 1;

    // New cycle starts from today, ends 30 days later
    const today = new Date();
    const cycleEnd = new Date(today);
    cycleEnd.setDate(cycleEnd.getDate() + 30);

    const title = `Cycle ${String(nextCycleNum).padStart(2, '0')}`;
    const startStr = today.toISOString().split('T')[0];
    const endStr = cycleEnd.toISOString().split('T')[0];

    const [result] = await db.query(
      `INSERT INTO service_cycles (project_id, project_service_id, cycle_number, title, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [projectId, serviceId, nextCycleNum, title, startStr, endStr, req.user.id]
    );

    // Create 7 standard sections
    const cycleId = result.insertId;
    const sections = [
      ['planning', 'Planning', 1],
      ['research', 'Research', 2],
      ['tasks', 'Tasks', 3],
      ['approvals', 'Approvals', 4],
      ['execution', 'Execution', 5],
      ['reporting', 'Reporting', 6],
      ['feedback', 'Feedback', 7],
    ];
    const sectionValues = sections.map(s => [cycleId, s[0], s[1], s[2]]);
    await db.query(
      'INSERT INTO cycle_sections (cycle_id, section_key, title, sort_order) VALUES ?',
      [sectionValues]
    );

    // Reactivate the service
    await db.query('UPDATE project_services SET status = ? WHERE id = ?', ['active', serviceId]);

    // Log
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'update', ?, ?)`,
      [projectId, `New cycle started: ${title}`, req.user.id]
    );

    return res.status(201).json({ message: `${title} created, service reactivated`, cycleId });
  } catch (err) {
    console.error('Create new cycle error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};
