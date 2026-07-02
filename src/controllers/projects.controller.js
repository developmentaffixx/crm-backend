const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects — list all projects
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, search, client_id } = req.query;

    // ── Base conditions (no status filter) — used for summary counts ──
    let baseWhere = 'p.deleted = 0';
    const baseParams = [];

    if (client_id) { baseWhere += ' AND p.client_id = ?'; baseParams.push(client_id); }
    if (search) {
      baseWhere += ' AND (p.title LIKE ? OR l.business_name LIKE ?)';
      const s = `%${search}%`;
      baseParams.push(s, s);
    }
    if (!req.user.is_admin) {
      baseWhere += ' AND (p.created_by = ? OR pm_self.user_id IS NOT NULL)';
      baseParams.push(req.user.id);
    }

    // ── Summary query — always runs across ALL statuses ──
    const [[summaryRow]] = await db.query(
      `SELECT
         COUNT(*)                                AS total,
         SUM(p.status = 'open')                 AS open,
         SUM(p.status = 'in_progress')          AS in_progress,
         SUM(p.status = 'completed')            AS completed,
         SUM(p.status = 'cancelled')            AS cancelled
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       ${!req.user.is_admin ? `LEFT JOIN project_members pm_self ON pm_self.project_id = p.id AND pm_self.user_id = ${req.user.id}` : ''}
       WHERE ${baseWhere}`,
      baseParams
    );
    const summary = {
      total:       Number(summaryRow.total       || 0),
      open:        Number(summaryRow.open        || 0),
      in_progress: Number(summaryRow.in_progress || 0),
      completed:   Number(summaryRow.completed   || 0),
      cancelled:   Number(summaryRow.cancelled   || 0),
    };

    // ── Main query — applies status filter ──
    let where = baseWhere;
    const params = [...baseParams];

    if (status === 'active') {
      where += ` AND p.status IN ('open', 'in_progress')`;
    } else if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    } else {
      // No filter passed — default to active only
      where += ` AND p.status IN ('open', 'in_progress')`;
    }

    const [rows] = await db.query(
      `SELECT p.*,
              l.business_name AS client_name,
              s.name AS service_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN services s ON s.id = p.service_id
       LEFT JOIN users uc ON uc.id = p.created_by
       ${!req.user.is_admin ? 'LEFT JOIN project_members pm_self ON pm_self.project_id = p.id AND pm_self.user_id = ' + req.user.id : ''}
       WHERE ${where}
       ORDER BY p.created_at DESC`,
      params
    );

    // Fetch member count for each project
    if (rows.length > 0) {
      const projectIds = rows.map(r => r.id);
      const [memberCounts] = await db.query(
        `SELECT project_id, COUNT(*) AS member_count FROM project_members WHERE project_id IN (?) GROUP BY project_id`,
        [projectIds]
      );
      const countMap = {};
      memberCounts.forEach(mc => { countMap[mc.project_id] = mc.member_count; });
      rows.forEach(r => { r.member_count = countMap[r.id] || 0; });

      // Fetch service count for each project
      const [serviceCounts] = await db.query(
        `SELECT project_id, COUNT(*) AS service_count FROM project_services WHERE project_id IN (?) GROUP BY project_id`,
        [projectIds]
      );
      const svcCountMap = {};
      serviceCounts.forEach(sc => { svcCountMap[sc.project_id] = sc.service_count; });
      rows.forEach(r => { r.service_count = svcCountMap[r.id] || 0; });
    }

    return res.json({ projects: rows, summary });
  } catch (err) {
    console.error('Projects list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/by-user/:userId — get projects where user is a member or creator
// ─────────────────────────────────────────────────────────────────────────────
exports.getByUser = async (req, res) => {
  try {
    const userId = req.params.userId;
    const [rows] = await db.query(
      `SELECT DISTINCT p.id, p.title, p.status
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id
       WHERE p.deleted = 0
         AND (pm.user_id = ? OR p.created_by = ?)
       ORDER BY p.title ASC`,
      [userId, userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Projects by user error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:id — get single project with members, tasks, activities
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*,
              l.business_name AS client_name,
              l.industry AS client_industry,
              s.name AS service_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN services s ON s.id = p.service_id
       LEFT JOIN users uc ON uc.id = p.created_by
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Project not found' });

    const project = rows[0];

    // Fetch members
    const [members] = await db.query(
      `SELECT pm.id AS membership_id, u.id, u.first_name, u.last_name, u.email, u.is_active
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY u.is_active DESC, u.first_name`,
      [project.id]
    );
    project.members = members;

    // Fetch linked tasks
    const [tasks] = await db.query(
      `SELECT t.id, t.title, t.status, t.priority, t.deadline,
              CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name
       FROM project_tasks pt
       JOIN tasks t ON t.id = pt.task_id AND t.deleted = 0
       LEFT JOIN users ua ON ua.id = t.assigned_to
       WHERE pt.project_id = ?
       ORDER BY t.created_at DESC`,
      [project.id]
    );
    project.tasks = tasks;

    // Fetch activities
    const [activities] = await db.query(
      `SELECT pa.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM project_activities pa
       JOIN users u ON u.id = pa.created_by
       WHERE pa.project_id = ?
       ORDER BY pa.created_at DESC`,
      [project.id]
    );
    project.activities = activities;

    // Fetch related tickets (tickets have project_id field)
    const [tickets] = await db.query(
      `SELECT tk.id, tk.title, tk.status, tk.priority, tk.ticket_type, tk.due_date,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.assigned_to
       WHERE tk.project_id = ? AND tk.deleted = 0
       ORDER BY tk.created_at DESC`,
      [project.id]
    );
    project.tickets = tickets;

    // Fetch related shoots (via client)
    const [shoots] = await db.query(
      `SELECT s.id, s.project_campaign_name, s.shoot_date, s.start_time, s.end_time,
              s.location_type, s.city, s.status, s.shoot_status
       FROM shoots s
       WHERE s.client_brand_id = ? AND s.deleted = 0
       ORDER BY s.shoot_date DESC`,
      [project.client_id || 0]
    );
    project.shoots = shoots;

    // Fetch DRS sections from client_drs (shared with client)
    if (project.client_id) {
      const [drs] = await db.query(
        `SELECT cd.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
         FROM client_drs cd
         LEFT JOIN users u ON u.id = cd.completed_by
         WHERE cd.client_id = ?`,
        [project.client_id]
      );
      project.drs = drs;
    } else {
      project.drs = [];
    }

    // Fetch project IBRS sections
    const [ibrs] = await db.query(
      `SELECT pi.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
       FROM project_ibrs pi
       LEFT JOIN users u ON u.id = pi.completed_by
       WHERE pi.project_id = ?`,
      [project.id]
    );
    project.ibrs = ibrs;

    // Fetch onboarding B data from client (if external project with client)
    if (project.client_id) {
      const [onbB] = await db.query(
        `SELECT * FROM client_onboarding_b WHERE client_id = ?`,
        [project.client_id]
      );
      project.onboarding_b = onbB[0] || null;
    }

    return res.json(project);
  } catch (err) {
    console.error('Project getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects — create project
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, project_type, client_id, service_id, start_date, end_date, status, members } = req.body;

  try {
    // Generate project_id_code: PRJ-CLIENT-###
    let clientCode = 'INT';
    const actualClientId = project_type === 'external' ? (client_id || null) : null;
    if (actualClientId) {
      const [clientRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [actualClientId]);
      if (clientRows.length > 0 && clientRows[0].client_code) {
        clientCode = clientRows[0].client_code;
      }
    }
    const [lastProject] = await db.query(
      `SELECT project_id_code FROM projects WHERE project_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
      [`PRJ-${clientCode}-%`]
    );
    let projectSeq = 1;
    if (lastProject.length > 0 && lastProject[0].project_id_code) {
      const parts = lastProject[0].project_id_code.split('-');
      projectSeq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    const project_id_code = `PRJ-${clientCode}-${String(projectSeq).padStart(3, '0')}`;

    const [result] = await db.query(
      `INSERT INTO projects (project_id_code, title, description, project_type, client_id, service_id, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_id_code,
        title,
        description || null,
        project_type || 'internal',
        actualClientId,
        service_id || null,
        start_date || null,
        end_date || null,
        status || 'open',
        req.user.id
      ]
    );

    const projectId = result.insertId;

    // Insert team members
    if (members && members.length > 0) {
      const memberValues = members.map(uid => [projectId, uid]);
      await db.query(
        `INSERT INTO project_members (project_id, user_id) VALUES ?`,
        [memberValues]
      );
    }

    // Add creation activity
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'created', 'Project created', ?)`,
      [projectId, req.user.id]
    );

    const [project] = await db.query('SELECT * FROM projects WHERE id = ?', [projectId]);
    res.emitSocket('projects:created', project[0]);
    return res.status(201).json(project[0]);
  } catch (err) {
    console.error('Project create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:id — update project
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM projects WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Project not found' });

    const project = rows[0];
    if (!req.user.is_admin && project.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const allowed = ['title', 'description', 'project_type', 'client_id', 'service_id', 'start_date', 'end_date', 'status', 'project_id_code'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Normalize empty strings to null for nullable fields
    const nullableFields = ['description', 'client_id', 'service_id', 'start_date', 'end_date'];
    nullableFields.forEach(f => {
      if (updates[f] === '' || updates[f] === 0 || updates[f] === '0') {
        updates[f] = null;
      }
    });

    // Don't allow empty project_id_code — remove from updates if blank
    if (updates.project_id_code !== undefined && !updates.project_id_code.trim()) {
      delete updates.project_id_code;
    }

    // If switching to internal, clear client_id
    if (updates.project_type === 'internal') {
      updates.client_id = null;
    }

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), req.params.id];
      await db.query(`UPDATE projects SET ${setClauses} WHERE id = ?`, values);
    }

    // Update members if provided
    if (req.body.members !== undefined) {
      await db.query('DELETE FROM project_members WHERE project_id = ?', [req.params.id]);
      if (req.body.members.length > 0) {
        const memberValues = req.body.members.map(uid => [req.params.id, uid]);
        await db.query('INSERT INTO project_members (project_id, user_id) VALUES ?', [memberValues]);
      }
    }

    const [updated] = await db.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    res.emitSocket('projects:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Project update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:id — soft delete
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM projects WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Project not found' });

    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('UPDATE projects SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('projects:deleted', { id: req.params.id });
    return res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Project delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:id/tasks — link a task to project
// ─────────────────────────────────────────────────────────────────────────────
exports.addTask = async (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) return res.status(400).json({ message: 'task_id is required' });

    await db.query(
      'INSERT IGNORE INTO project_tasks (project_id, task_id) VALUES (?, ?)',
      [req.params.id, task_id]
    );
    return res.status(201).json({ message: 'Task linked to project' });
  } catch (err) {
    console.error('Add task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:id/tasks/:taskId — unlink a task
// ─────────────────────────────────────────────────────────────────────────────
exports.removeTask = async (req, res) => {
  try {
    await db.query(
      'DELETE FROM project_tasks WHERE project_id = ? AND task_id = ?',
      [req.params.id, req.params.taskId]
    );
    return res.json({ message: 'Task unlinked from project' });
  } catch (err) {
    console.error('Remove task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:id/activities — add activity/note
// ─────────────────────────────────────────────────────────────────────────────
exports.addActivity = async (req, res) => {
  try {
    const { type, note } = req.body;
    if (!note) return res.status(400).json({ message: 'Note is required' });

    const [result] = await db.query(
      'INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, ?, ?, ?)',
      [req.params.id, type || 'note', note, req.user.id]
    );

    const [activity] = await db.query(
      `SELECT pa.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM project_activities pa JOIN users u ON u.id = pa.created_by
       WHERE pa.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(activity[0]);
  } catch (err) {
    console.error('Add activity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/clients — get leads with business_name for dropdown
// ─────────────────────────────────────────────────────────────────────────────
exports.getClients = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, business_name FROM leads WHERE deleted = 0 AND status = 'Won' AND business_name IS NOT NULL AND business_name != '' ORDER BY business_name ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get clients error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT DRS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/projects/:id/drs — get all DRS sections (from client_drs via project's client_id)
exports.getDrs = async (req, res) => {
  try {
    // Get the project's client_id
    const [proj] = await db.query('SELECT client_id FROM projects WHERE id = ?', [req.params.id]);
    if (proj.length === 0) return res.status(404).json({ message: 'Project not found' });
    const clientId = proj[0].client_id;
    if (!clientId) return res.json([]);

    const [rows] = await db.query(
      `SELECT cd.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
       FROM client_drs cd
       LEFT JOIN users u ON u.id = cd.completed_by
       WHERE cd.client_id = ?`,
      [clientId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get project DRS error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/projects/:id/drs/:section — save DRS section (to client_drs via project's client_id)
exports.saveDrs = async (req, res) => {
  try {
    const { data, completed } = req.body;
    const section = req.params.section;

    // Get the project's client_id
    const [proj] = await db.query('SELECT client_id FROM projects WHERE id = ?', [req.params.id]);
    if (proj.length === 0) return res.status(404).json({ message: 'Project not found' });
    const clientId = proj[0].client_id;
    if (!clientId) return res.status(400).json({ message: 'Project has no linked client' });

    const validSections = ['account_manager', 'content_writer', 'graphic_designer', 'video_editor', 'videographer', 'ads_manager'];
    if (!validSections.includes(section)) {
      return res.status(400).json({ message: 'Invalid DRS section' });
    }

    const jsonData = JSON.stringify(data || {});
    const [existing] = await db.query('SELECT id FROM client_drs WHERE client_id = ? AND section = ?', [clientId, section]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE client_drs SET data = ?, completed = ?, completed_by = ?, completed_at = ? WHERE client_id = ? AND section = ?`,
        [jsonData, completed ? 1 : 0, completed ? req.user.id : null, completed ? new Date() : null, clientId, section]
      );
    } else {
      await db.query(
        `INSERT INTO client_drs (client_id, section, data, completed, completed_by, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [clientId, section, jsonData, completed ? 1 : 0, completed ? req.user.id : null, completed ? new Date() : null]
      );
    }

    return res.json({ message: 'DRS section saved' });
  } catch (err) {
    console.error('Save project DRS error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT IBRS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/projects/:id/ibrs — get all IBRS sections
exports.getIbrs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pi.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
       FROM project_ibrs pi
       LEFT JOIN users u ON u.id = pi.completed_by
       WHERE pi.project_id = ?`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get project IBRS error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/projects/:id/ibrs/:section — save IBRS section
exports.saveIbrs = async (req, res) => {
  try {
    const { data, completed } = req.body;
    const section = req.params.section;

    await db.query(
      `INSERT INTO project_ibrs (project_id, section, data, completed, completed_by, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), completed = VALUES(completed),
         completed_by = VALUES(completed_by), completed_at = VALUES(completed_at)`,
      [
        req.params.id, section, JSON.stringify(data),
        completed ? 1 : 0,
        completed ? req.user.id : null,
        completed ? new Date() : null
      ]
    );

    return res.json({ message: 'IBRS section saved' });
  } catch (err) {
    console.error('Save project IBRS error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

