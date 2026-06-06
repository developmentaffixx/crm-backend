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
// Helper: Generate ONE next cycle for a project
// ─────────────────────────────────────────────────────────────────────────────
async function generateNextCycleForProject(projectId, startDate, userId) {
  const start = new Date(startDate);

  // Get existing max cycle number
  const [existing] = await db.query(
    'SELECT MAX(cycle_number) AS max_num FROM service_cycles WHERE project_id = ?',
    [projectId]
  );
  const nextCycleNum = (existing[0].max_num || 0) + 1;

  // Calculate start date for this cycle
  const cycleStart = new Date(start);
  cycleStart.setMonth(cycleStart.getMonth() + (nextCycleNum - 1));

  const cycleEnd = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);
  cycleEnd.setDate(cycleEnd.getDate() - 1);

  const title = `Cycle ${String(nextCycleNum).padStart(2, '0')}`;

  const [result] = await db.query(
    `INSERT INTO service_cycles (project_id, cycle_number, title, start_date, end_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [projectId, nextCycleNum, title, formatDate(cycleStart), formatDate(cycleEnd), userId]
  );

  const cycleId = result.insertId;

  // Create standard sections for this cycle
  const sectionValues = CYCLE_SECTIONS.map(s => [cycleId, s.section_key, s.title, s.sort_order]);
  await db.query(
    `INSERT INTO cycle_sections (cycle_id, section_key, title, sort_order) VALUES ?`,
    [sectionValues]
  );

  return { id: cycleId, cycle_number: nextCycleNum, title, start_date: formatDate(cycleStart), end_date: formatDate(cycleEnd), status: 'active' };
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/cycles — list all cycles for a project
// ─────────────────────────────────────────────────────────────────────────────
exports.listCycles = async (req, res) => {
  try {
    const projectId = req.params.projectId;

    const [cycles] = await db.query(
      `SELECT sc.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM cycle_tasks ct WHERE ct.cycle_id = sc.id) AS task_count,
              (SELECT COUNT(*) FROM cycle_sections cs WHERE cs.cycle_id = sc.id AND cs.status = 'completed') AS completed_sections,
              (SELECT COUNT(*) FROM cycle_sections cs WHERE cs.cycle_id = sc.id) AS total_sections
       FROM service_cycles sc
       LEFT JOIN users u ON u.id = sc.created_by
       WHERE sc.project_id = ?
       ORDER BY sc.cycle_number ASC`,
      [projectId]
    );

    return res.json(cycles);
  } catch (err) {
    console.error('List cycles error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/cycles/generate — generate first cycle
// ─────────────────────────────────────────────────────────────────────────────
exports.generateCycles = async (req, res) => {
  try {
    const projectId = req.params.projectId;

    // Get project start_date
    const [project] = await db.query(
      'SELECT id, start_date FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );

    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!project[0].start_date) {
      return res.status(400).json({ message: 'Project must have a start date to generate cycles' });
    }

    // Check if any cycle already exists
    const [existing] = await db.query(
      'SELECT id FROM service_cycles WHERE project_id = ? LIMIT 1',
      [projectId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Cycle already exists. Complete current cycle to generate next.' });
    }

    const cycle = await generateNextCycleForProject(projectId, project[0].start_date, req.user.id);

    return res.status(201).json({ message: 'Cycle 01 generated', cycle });
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

    // Get linked tasks
    const [tasks] = await db.query(
      `SELECT t.id, t.title, t.status, t.priority, t.deadline,
              CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name
       FROM cycle_tasks ct
       JOIN tasks t ON t.id = ct.task_id AND t.deleted = 0
       LEFT JOIN users ua ON ua.id = t.assigned_to
       WHERE ct.cycle_id = ?
       ORDER BY t.created_at DESC`,
      [cycleId]
    );
    cycle.tasks = tasks;

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
    const updates = {};
    if (notes !== undefined) updates.notes = notes;

    if (status !== undefined) {
      updates.status = status;

      // Pause: record when paused
      if (status === 'paused' && currentCycle.status === 'active') {
        updates.paused_at = new Date();
      }

      // Resume: record when resumed, set back to active
      if (status === 'active' && currentCycle.status === 'paused') {
        updates.resumed_at = new Date();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE service_cycles SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), cycleId]
    );

    // If marking as completed, auto-generate next cycle
    if (status === 'completed') {
      // Get project start_date for date calculation
      const [proj] = await db.query('SELECT start_date FROM projects WHERE id = ?', [projectId]);
      if (proj.length > 0 && proj[0].start_date) {
        try {
          await generateNextCycleForProject(projectId, proj[0].start_date, req.user.id);
        } catch (genErr) {
          // If next cycle already exists (edge case), just ignore
          if (genErr.code !== 'ER_DUP_ENTRY') {
            console.error('Auto-generate next cycle error:', genErr);
          }
        }
      }
    }

    const [updated] = await db.query('SELECT * FROM service_cycles WHERE id = ?', [cycleId]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Update cycle error:', err);
    return res.status(500).json({ message: 'Server error' });
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
// POST /api/projects/:projectId/cycles/generate-next — auto-generate next cycle
// Called when current cycle is completed (also triggered automatically)
// ─────────────────────────────────────────────────────────────────────────────
exports.generateNextCycle = async (req, res) => {
  try {
    const projectId = req.params.projectId;

    // Get project start_date
    const [project] = await db.query(
      'SELECT id, start_date FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!project[0].start_date) {
      return res.status(400).json({ message: 'Project must have a start date' });
    }

    // Check if there's an active or paused cycle (can't generate next if current isn't completed)
    const [activeCycles] = await db.query(
      `SELECT id, status FROM service_cycles WHERE project_id = ? AND status IN ('active', 'paused') LIMIT 1`,
      [projectId]
    );
    if (activeCycles.length > 0) {
      const msg = activeCycles[0].status === 'paused'
        ? 'Current cycle is paused. Resume and complete it before generating the next one.'
        : 'Complete the current active cycle before generating the next one.';
      return res.status(400).json({ message: msg });
    }

    const cycle = await generateNextCycleForProject(projectId, project[0].start_date, req.user.id);
    return res.status(201).json({ message: 'Next cycle generated', cycle });
  } catch (err) {
    console.error('Generate next cycle error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
