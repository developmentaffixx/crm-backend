const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects — list all projects
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, search, client_id } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (client_id) { where += ' AND p.client_id = ?'; params.push(client_id); }
    if (search) {
      where += ' AND (p.title LIKE ? OR l.business_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    // Non-admin: only see projects they are a member of or created
    if (!req.user.is_admin) {
      where += ' AND (p.created_by = ? OR pm_self.user_id IS NOT NULL)';
      params.push(req.user.id);
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
    }

    // Summary counts
    const summary = {
      total:       rows.length,
      open:        rows.filter(r => r.status === 'open').length,
      in_progress: rows.filter(r => r.status === 'in_progress').length,
      completed:   rows.filter(r => r.status === 'completed').length,
      cancelled:   rows.filter(r => r.status === 'cancelled').length,
    };

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
      `SELECT pm.id AS membership_id, u.id, u.first_name, u.last_name, u.email
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY u.first_name`,
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
    const [result] = await db.query(
      `INSERT INTO projects (title, description, project_type, client_id, service_id, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description || null,
        project_type || 'internal',
        project_type === 'external' ? (client_id || null) : null,
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

    const allowed = ['title', 'description', 'project_type', 'client_id', 'service_id', 'start_date', 'end_date', 'status'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

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
      `SELECT id, name, business_name FROM leads WHERE deleted = 0 AND business_name IS NOT NULL AND business_name != '' ORDER BY business_name ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get clients error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
