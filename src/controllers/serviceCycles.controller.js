const db = require('../config/db');

// Standard sections created for every cycle
const CYCLE_SECTIONS = [
  { section_key: 'planning',   title: 'Planning',   sort_order: 1 },
  { section_key: 'research',   title: 'Research',   sort_order: 2 },
  { section_key: 'tasks',      title: 'Tasks',      sort_order: 3 },
  { section_key: 'approvals',  title: 'Approvals',  sort_order: 4 },
  { section_key: 'execution',  title: 'Execution',  sort_order: 5 },
  { section_key: 'reporting',  title: 'Reporting',  sort_order: 6 },
  { section_key: 'feedback',   title: 'Feedback',   sort_order: 7 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Generate ONE next cycle for a project service (or legacy project)
// ─────────────────────────────────────────────────────────────────────────────
async function generateNextCycleForProject(projectId, startDate, endDate, userId, projectServiceId = null, cycleStatus = 'active') {
  // cycle_number must be unique per project (uq_project_cycle constraint on project_id+cycle_number)
  // So always get the max across the ENTIRE project to avoid duplicate key errors
  const [existing] = await db.query(
    'SELECT MAX(cycle_number) AS max_num FROM service_cycles WHERE project_id = ?',
    [projectId]
  );
  const nextCycleNum = (existing[0].max_num || 0) + 1;

  // For display title use per-service count so each service shows Cycle 01, 02...
  let serviceCycleNum = 1;
  if (projectServiceId) {
    const [svcExisting] = await db.query(
      'SELECT COUNT(*) AS cycle_count FROM service_cycles WHERE project_service_id = ?',
      [projectServiceId]
    );
    serviceCycleNum = (svcExisting[0].cycle_count || 0) + 1;
  }

  // Use provided dates (manual creation)
  const cycleStart = startDate ? new Date(startDate) : new Date();
  const cycleEnd = endDate ? new Date(endDate) : new Date(cycleStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  const title = `Cycle ${String(serviceCycleNum).padStart(2, '0')}`;

  const [result] = await db.query(
    `INSERT INTO service_cycles (project_id, project_service_id, cycle_number, title, start_date, end_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, projectServiceId, nextCycleNum, title, formatDate(cycleStart), formatDate(cycleEnd), cycleStatus, userId]
  );

  const cycleId = result.insertId;

  // Create standard sections for this cycle
  const sectionValues = CYCLE_SECTIONS.map(s => [cycleId, s.section_key, s.title, s.sort_order]);
  await db.query(
    `INSERT INTO cycle_sections (cycle_id, section_key, title, sort_order) VALUES ?`,
    [sectionValues]
  );

  return { id: cycleId, cycle_number: nextCycleNum, title, start_date: formatDate(cycleStart), end_date: formatDate(cycleEnd), status: cycleStatus };
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/cycles — list all cycles for a project
// Also supports ?project_service_id=X to filter by service
// ─────────────────────────────────────────────────────────────────────────────
exports.listCycles = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { project_service_id, status } = req.query;

    let whereClause = 'sc.project_id = ?';
    const params = [projectId];

    if (project_service_id) {
      whereClause = 'sc.project_service_id = ?';
      params[0] = project_service_id;
    }

    // Optional status filter (e.g. status=active or status=active,upcoming for multiple)
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        whereClause += ' AND sc.status = ?';
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        whereClause += ` AND sc.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
    }

    const [cycles] = await db.query(
      `SELECT sc.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM cycle_tasks ct WHERE ct.cycle_id = sc.id) AS task_count,
              (SELECT COUNT(*) FROM cycle_sections cs WHERE cs.cycle_id = sc.id AND cs.status = 'completed') AS completed_sections,
              (SELECT COUNT(*) FROM cycle_sections cs WHERE cs.cycle_id = sc.id) AS total_sections
       FROM service_cycles sc
       LEFT JOIN users u ON u.id = sc.created_by
       WHERE ${whereClause}
       ORDER BY sc.cycle_number ASC`,
      params
    );

    return res.json(cycles);
  } catch (err) {
    console.error('List cycles error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/cycles/generate — generate first cycle
// Supports ?project_service_id=X to generate for a specific service
// ─────────────────────────────────────────────────────────────────────────────
exports.generateCycles = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { project_service_id, start_date, end_date } = req.body;

    // Validate required dates
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    // Get project
    const [project] = await db.query(
      'SELECT id, start_date FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );

    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    let psId = project_service_id || null;

    if (psId) {
      const [ps] = await db.query(
        'SELECT id FROM project_services WHERE id = ? AND project_id = ?',
        [psId, projectId]
      );
      if (ps.length === 0) {
        return res.status(404).json({ message: 'Project service not found' });
      }
    }

    // Check for date overlap with existing cycles in this scope
    let overlapQuery, overlapParams;
    if (psId) {
      overlapQuery = `SELECT id, title, start_date, end_date FROM service_cycles WHERE project_service_id = ? AND status != 'skipped' AND (start_date <= ? AND end_date >= ?) LIMIT 1`;
      overlapParams = [psId, end_date, start_date];
    } else {
      overlapQuery = `SELECT id, title, start_date, end_date FROM service_cycles WHERE project_id = ? AND project_service_id IS NULL AND status != 'skipped' AND (start_date <= ? AND end_date >= ?) LIMIT 1`;
      overlapParams = [projectId, end_date, start_date];
    }
    const [overlapping] = await db.query(overlapQuery, overlapParams);
    if (overlapping.length > 0) {
      const ov = overlapping[0];
      return res.status(409).json({ message: `Date range overlaps with "${ov.title}" (${ov.start_date.toISOString().split('T')[0]} to ${ov.end_date.toISOString().split('T')[0]}). Choose non-overlapping dates.` });
    }

    // Determine status based on dates
    const today = new Date().toISOString().split('T')[0];
    const cycleStatus = start_date > today ? 'upcoming' : 'active';

    const cycle = await generateNextCycleForProject(projectId, start_date, end_date, req.user.id, psId, cycleStatus);

    // Log activity
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'update', ?, ?)`,
      [projectId, `New cycle created: ${cycle.title}`, req.user.id]
    );

    return res.status(201).json({ message: `${cycle.title} created`, cycle });
  } catch (err) {
    console.error('Generate cycles error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Cycle already exists.' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/cycles/:cycleId — get cycle detail with sections
// Also returns tasks, tickets, content posts, shoots filtered by cycle date range
// ─────────────────────────────────────────────────────────────────────────────
exports.getCycleDetail = async (req, res) => {
  try {
    const { projectId, cycleId } = req.params;

    const [cycles] = await db.query(
      `SELECT sc.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM service_cycles sc
       LEFT JOIN users u ON u.id = sc.created_by
       WHERE sc.id = ? AND sc.project_id = ?`,
      [cycleId, projectId]
    );

    if (cycles.length === 0) {
      return res.status(404).json({ message: 'Cycle not found' });
    }

    const cycle = cycles[0];

    // Get sections
    const [sections] = await db.query(
      `SELECT cs.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
       FROM cycle_sections cs
       LEFT JOIN users u ON u.id = cs.completed_by
       WHERE cs.cycle_id = ?
       ORDER BY cs.sort_order ASC`,
      [cycleId]
    );
    cycle.sections = sections;

    // Get explicitly linked tasks (cycle_tasks)
    const [linkedTasks] = await db.query(
      `SELECT t.id, t.title, t.status, t.priority, t.deadline, t.start_date,
              CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name
       FROM cycle_tasks ct
       JOIN tasks t ON t.id = ct.task_id AND t.deleted = 0
       LEFT JOIN users ua ON ua.id = t.assigned_to
       WHERE ct.cycle_id = ?
       ORDER BY t.deadline ASC, t.created_at DESC`,
      [cycleId]
    );

    // Date-range fallback ONLY for project-level cycles (no project_service_id).
    // For service-scoped cycles, tasks must be explicitly linked via cycle_tasks —
    // never bleed tasks from other services based on date range alone.
    let dateRangeTasks = [];
    if (!cycle.project_service_id) {
      const [rows] = await db.query(
        `SELECT DISTINCT t.id, t.title, t.status, t.priority, t.deadline, t.start_date,
                CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name
         FROM project_tasks pt
         JOIN tasks t ON t.id = pt.task_id AND t.deleted = 0
         LEFT JOIN users ua ON ua.id = t.assigned_to
         WHERE pt.project_id = ?
           AND t.deadline >= ? AND t.deadline <= ?
           AND t.id NOT IN (SELECT task_id FROM cycle_tasks WHERE cycle_id = ?)
         ORDER BY t.deadline ASC`,
        [projectId, cycle.start_date, cycle.end_date, cycleId]
      );
      dateRangeTasks = rows;
    }

    cycle.tasks = [...linkedTasks, ...dateRangeTasks];

    // Get tickets by date range (due_date or created_at within cycle period)
    const [tickets] = await db.query(
      `SELECT tk.id, tk.title, tk.status, tk.priority, tk.ticket_type, tk.due_date,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.assigned_to
       WHERE tk.project_id = ? AND tk.deleted = 0
         AND (
           (tk.due_date >= ? AND tk.due_date <= ?)
           OR (tk.due_date IS NULL AND tk.created_at >= ? AND tk.created_at <= ?)
         )
       ORDER BY COALESCE(tk.due_date, tk.created_at) ASC`,
      [projectId, cycle.start_date, cycle.end_date, cycle.start_date, cycle.end_date + ' 23:59:59']
    );
    cycle.tickets = tickets;

    // Get content calendar posts by date range (posting_date within cycle period)
    // Content plans are linked to client, so we need the project's client_id
    const [projData] = await db.query('SELECT client_id FROM projects WHERE id = ?', [projectId]);
    const clientId = projData[0]?.client_id;

    if (clientId) {
      const [contentPosts] = await db.query(
        `SELECT ccp.id, ccp.topic, ccp.format, ccp.platform, ccp.posting_date, ccp.status, ccp.ad_target
         FROM content_calendar_posts ccp
         JOIN content_calendar_plans ccpl ON ccpl.id = ccp.plan_id AND ccpl.deleted = 0
         WHERE ccpl.client_id = ?
           AND ccp.posting_date >= ? AND ccp.posting_date <= ?
         ORDER BY ccp.posting_date ASC`,
        [clientId, cycle.start_date, cycle.end_date]
      );
      cycle.content_posts = contentPosts;

      // Get ads by date range (start_date within cycle period)
      const [ads] = await db.query(
        `SELECT cca.id, cca.creative_name, cca.campaign_objective, cca.platform,
                cca.ad_status, cca.budget, cca.start_date, cca.end_date, cca.target_audience
         FROM content_calendar_ads cca
         JOIN content_calendar_plans ccpl ON ccpl.id = cca.plan_id AND ccpl.deleted = 0
         WHERE ccpl.client_id = ?
           AND cca.start_date >= ? AND cca.start_date <= ?
         ORDER BY cca.start_date ASC`,
        [clientId, cycle.start_date, cycle.end_date]
      );
      cycle.ads = ads;

      // Get shoots by date range (shoot_date within cycle period)
      const [shoots] = await db.query(
        `SELECT s.id, s.project_campaign_name, s.shoot_date, s.start_time, s.end_time,
                s.location_type, s.city, s.status, s.shoot_status
         FROM shoots s
         WHERE s.client_brand_id = ? AND s.deleted = 0
           AND s.shoot_date >= ? AND s.shoot_date <= ?
         ORDER BY s.shoot_date ASC`,
        [clientId, cycle.start_date, cycle.end_date]
      );
      cycle.shoots = shoots;
    } else {
      cycle.content_posts = [];
      cycle.ads = [];
      cycle.shoots = [];
    }

    // Get cycle approvals
    const [approvals] = await db.query(
      `SELECT ca.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM cycle_approvals ca
       LEFT JOIN users u ON u.id = ca.created_by
       WHERE ca.cycle_id = ?
       ORDER BY ca.created_at DESC`,
      [cycleId]
    );
    cycle.approvals = approvals;

    // Feedback is stored in service_cycles.notes
    cycle.feedback = cycle.notes || '';

    // If cycle is paused, hide tasks and tickets from non-admin users
    if (cycle.status === 'paused' && !req.user.is_admin) {
      cycle.tasks = [];
      cycle.tickets = [];
      cycle.is_paused_hidden = true; // flag for frontend to show message
    }

    return res.json(cycle);
  } catch (err) {
    console.error('Get cycle detail error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:projectId/cycles/:cycleId — update cycle (status, notes)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateCycle = async (req, res) => {
  try {
    const { projectId, cycleId } = req.params;
    const { status, notes } = req.body;

    const [existing] = await db.query(
      'SELECT * FROM service_cycles WHERE id = ? AND project_id = ?',
      [cycleId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Cycle not found' });
    }

    const currentCycle = existing[0];
    const updates = [];
    const values = [];

    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    await db.query(
      `UPDATE service_cycles SET ${updates.join(', ')} WHERE id = ?`,
      [...values, cycleId]
    );

    // ── When a cycle is closed (completed or skipped), check for upcoming cycles ──
    // If this service has an upcoming cycle, immediately promote the earliest one
    // to active (by start_date ASC). This handles the case where a paused cycle
    // is manually closed and the next cycle should kick in right away.
    if ((status === 'completed' || status === 'skipped') && currentCycle.project_service_id) {

      // Log the closure activity
      const closureLabel = status === 'completed' ? 'completed' : 'skipped';
      await db.query(
        `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'milestone', ?, ?)`,
        [projectId, `Cycle ${closureLabel}: ${currentCycle.title}`, req.user.id]
      );

      // Find the earliest upcoming cycle for this service (if any)
      const [nextUpcoming] = await db.query(
        `SELECT id, title, start_date
         FROM service_cycles
         WHERE project_service_id = ? AND status = 'upcoming'
         ORDER BY start_date ASC, cycle_number ASC
         LIMIT 1`,
        [currentCycle.project_service_id]
      );

      if (nextUpcoming.length > 0) {
        // Promote the next upcoming cycle to active immediately
        const next = nextUpcoming[0];
        await db.query(
          `UPDATE service_cycles SET status = 'active' WHERE id = ?`,
          [next.id]
        );
        await db.query(
          `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'update', ?, ?)`,
          [projectId, `${next.title} activated after ${currentCycle.title} was ${closureLabel}`, req.user.id]
        );
      } else {
        // No upcoming cycle — check if all cycles for this service are now done
        // If so, mark the service itself as completed
        const [remainingActive] = await db.query(
          `SELECT id FROM service_cycles WHERE project_service_id = ? AND status IN ('active', 'paused') AND id != ?`,
          [currentCycle.project_service_id, cycleId]
        );
        if (remainingActive.length === 0) {
          await db.query(
            'UPDATE project_services SET status = ? WHERE id = ?',
            ['completed', currentCycle.project_service_id]
          );
        }
      }

      // Recalculate project status based on current service statuses
      const [allServices] = await db.query(
        'SELECT status FROM project_services WHERE project_id = ?',
        [projectId]
      );
      if (allServices.length > 0) {
        const svcStatuses = allServices.map(s => s.status);
        const hasActive = svcStatuses.includes('active');
        const newProjectStatus = hasActive ? 'active' : 'inactive';
        await db.query('UPDATE projects SET status = ? WHERE id = ?', [newProjectStatus, projectId]);
      }
    }

    // Cycles are manually created — no auto-generation on completion

    const [updated] = await db.query('SELECT * FROM service_cycles WHERE id = ?', [cycleId]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Update cycle error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message || String(err) });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:projectId/cycles/:cycleId/sections/:sectionId — update section
// ─────────────────────────────────────────────────────────────────────────────
exports.updateSection = async (req, res) => {
  try {
    const { cycleId, sectionId } = req.params;
    const { content, status } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM cycle_sections WHERE id = ? AND cycle_id = ?',
      [sectionId, cycleId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Section not found' });
    }

    const updates = {};
    if (content !== undefined) updates.content = content;
    if (status !== undefined) {
      updates.status = status;
      if (status === 'completed') {
        updates.completed_by = req.user.id;
        updates.completed_at = new Date();
      } else {
        updates.completed_by = null;
        updates.completed_at = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE cycle_sections SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), sectionId]
    );

    const [updated] = await db.query(
      `SELECT cs.*, CONCAT(u.first_name, ' ', u.last_name) AS completed_by_name
       FROM cycle_sections cs
       LEFT JOIN users u ON u.id = cs.completed_by
       WHERE cs.id = ?`,
      [sectionId]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Update section error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/cycles/:cycleId/tasks — link task to cycle
// ─────────────────────────────────────────────────────────────────────────────
exports.addCycleTask = async (req, res) => {
  try {
    const { cycleId } = req.params;
    const { task_id } = req.body;

    if (!task_id) return res.status(400).json({ message: 'task_id is required' });

    await db.query(
      'INSERT IGNORE INTO cycle_tasks (cycle_id, task_id) VALUES (?, ?)',
      [cycleId, task_id]
    );
    return res.status(201).json({ message: 'Task linked to cycle' });
  } catch (err) {
    console.error('Add cycle task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/cycles/:cycleId/tasks/:taskId — unlink task
// ─────────────────────────────────────────────────────────────────────────────
exports.removeCycleTask = async (req, res) => {
  try {
    const { cycleId, taskId } = req.params;
    await db.query(
      'DELETE FROM cycle_tasks WHERE cycle_id = ? AND task_id = ?',
      [cycleId, taskId]
    );
    return res.json({ message: 'Task unlinked from cycle' });
  } catch (err) {
    console.error('Remove cycle task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/cycles/generate-next — manually create next cycle
// Supports body: { project_service_id, start_date, end_date }
// ─────────────────────────────────────────────────────────────────────────────
exports.generateNextCycle = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { project_service_id, start_date, end_date } = req.body;

    // Validate required dates
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    // Get project
    const [project] = await db.query(
      'SELECT id FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    let psId = project_service_id || null;

    if (psId) {
      const [ps] = await db.query(
        `SELECT ps.id, s.service_type
         FROM project_services ps
         JOIN services s ON s.id = ps.service_id
         WHERE ps.id = ? AND ps.project_id = ?`,
        [psId, projectId]
      );
      if (ps.length === 0) {
        return res.status(404).json({ message: 'Project service not found' });
      }

      // Block next cycle generation for one-time services that already have a completed cycle
      if (ps[0].service_type === 'one_time') {
        const [existingCycles] = await db.query(
          `SELECT id FROM service_cycles WHERE project_service_id = ? LIMIT 1`,
          [psId]
        );
        if (existingCycles.length > 0) {
          return res.status(400).json({ message: 'This is a one-time service. It does not support multiple cycles.' });
        }
      }
    }

    // Check for date overlap with existing cycles in this scope
    let activeQuery, activeParams;
    if (psId) {
      activeQuery = `SELECT id, title, start_date, end_date FROM service_cycles WHERE project_service_id = ? AND status != 'skipped' AND (start_date <= ? AND end_date >= ?) LIMIT 1`;
      activeParams = [psId, end_date, start_date];
    } else {
      activeQuery = `SELECT id, title, start_date, end_date FROM service_cycles WHERE project_id = ? AND project_service_id IS NULL AND status != 'skipped' AND (start_date <= ? AND end_date >= ?) LIMIT 1`;
      activeParams = [projectId, end_date, start_date];
    }

    const [activeCycles] = await db.query(activeQuery, activeParams);
    if (activeCycles.length > 0) {
      const ov = activeCycles[0];
      return res.status(400).json({ message: `Date range overlaps with "${ov.title}" (${ov.start_date.toISOString().split('T')[0]} to ${ov.end_date.toISOString().split('T')[0]}). Choose non-overlapping dates.` });
    }

    // Determine status based on dates
    const today = new Date().toISOString().split('T')[0];
    const cycleStatus = start_date > today ? 'upcoming' : 'active';

    const cycle = await generateNextCycleForProject(projectId, start_date, end_date, req.user.id, psId, cycleStatus);

    // Log activity
    await db.query(
      `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'update', ?, ?)`,
      [projectId, `New cycle created: ${cycle.title}`, req.user.id]
    );

    return res.status(201).json({ message: `${cycle.title} created`, cycle });
  } catch (err) {
    console.error('Generate next cycle error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/cycles/:cycleId/approvals — add client approval item
// ─────────────────────────────────────────────────────────────────────────────
exports.addApproval = async (req, res) => {
  try {
    const { cycleId } = req.params;
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const [result] = await db.query(
      'INSERT INTO cycle_approvals (cycle_id, title, created_by) VALUES (?, ?, ?)',
      [cycleId, title.trim(), req.user.id]
    );

    const [row] = await db.query(
      `SELECT ca.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM cycle_approvals ca LEFT JOIN users u ON u.id = ca.created_by WHERE ca.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(row[0]);
  } catch (err) {
    console.error('Add approval error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:projectId/cycles/:cycleId/approvals/:approvalId — update approval status
// ─────────────────────────────────────────────────────────────────────────────
exports.updateApproval = async (req, res) => {
  try {
    const { approvalId } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updates = [];
    const values = [];
    if (status) {
      updates.push('status = ?');
      values.push(status);
      if (status === 'approved') {
        updates.push('approved_at = NOW()');
      } else {
        updates.push('approved_at = NULL');
      }
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    await db.query(
      `UPDATE cycle_approvals SET ${updates.join(', ')} WHERE id = ?`,
      [...values, approvalId]
    );

    const [row] = await db.query(
      `SELECT ca.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM cycle_approvals ca LEFT JOIN users u ON u.id = ca.created_by WHERE ca.id = ?`,
      [approvalId]
    );

    return res.json(row[0]);
  } catch (err) {
    console.error('Update approval error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/cycles/:cycleId/approvals/:approvalId — delete approval
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteApproval = async (req, res) => {
  try {
    const { approvalId } = req.params;
    await db.query('DELETE FROM cycle_approvals WHERE id = ?', [approvalId]);
    return res.json({ message: 'Approval deleted' });
  } catch (err) {
    console.error('Delete approval error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:projectId/cycles/:cycleId/feedback — save cycle feedback
// ─────────────────────────────────────────────────────────────────────────────
exports.saveFeedback = async (req, res) => {
  try {
    const { projectId, cycleId } = req.params;
    const { feedback } = req.body;

    await db.query(
      'UPDATE service_cycles SET notes = ? WHERE id = ? AND project_id = ?',
      [feedback || '', cycleId, projectId]
    );

    return res.json({ message: 'Feedback saved' });
  } catch (err) {
    console.error('Save feedback error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};
