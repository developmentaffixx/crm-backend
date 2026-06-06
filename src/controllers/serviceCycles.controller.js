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
// Helper: Generate cycles for a project based on start_date
// ─────────────────────────────────────────────────────────────────────────────
async function generateCyclesForProject(projectId, startDate, numberOfCycles, userId) {
  const start = new Date(startDate);
  const createdCycles = [];

  // Get existing max cycle number
  const [existing] = await db.query(
    'SELECT MAX(cycle_number) AS max_num FROM service_cycles WHERE project_id = ?',
    [projectId]
  );
  let nextCycleNum = (existing[0].max_num || 0) + 1;

  for (let i = 0; i < numberOfCycles; i++) {
    const cycleStart = new Date(start);
    cycleStart.setMonth(cycleStart.getMonth() + (nextCycleNum - 1 + i));

    const cycleEnd = new Date(cycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    cycleEnd.setDate(cycleEnd.getDate() - 1);

    const cycleNum = nextCycleNum + i;
    const title = `Cycle ${String(cycleNum).padStart(2, '0')}`;
    const status = i === 0 && nextCycleNum === 1 ? 'active' : 'upcoming';

    const [result] = await db.query(
      `INSERT INTO service_cycles (project_id, cycle_number, title, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [projectId, cycleNum, title, formatDate(cycleStart), formatDate(cycleEnd), status, userId]
    );

    const cycleId = result.insertId;

    // Create standard sections for this cycle
    const sectionValues = CYCLE_SECTIONS.map(s => [cycleId, s.section_key, s.title, s.sort_order]);
    await db.query(
      `INSERT INTO cycle_sections (cycle_id, section_key, title, sort_order) VALUES ?`,
      [sectionValues]
    );

    createdCycles.push({ id: cycleId, cycle_number: cycleNum, title, start_date: formatDate(cycleStart), end_date: formatDate(cycleEnd), status });
  }

  return createdCycles;
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
// POST /api/projects/:projectId/cycles/generate — generate cycles
// Body: { number_of_cycles: 3 } (optional, defaults to 3)
// ─────────────────────────────────────────────────────────────────────────────
exports.generateCycles = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { number_of_cycles = 3 } = req.body;

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

    const cycles = await generateCyclesForProject(
      projectId,
      project[0].start_date,
      Math.min(number_of_cycles, 12), // Cap at 12 cycles max at once
      req.user.id
    );

    return res.status(201).json({ message: `${cycles.length} cycle(s) generated`, cycles });
  } catch (err) {
    console.error('Generate cycles error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Some cycles already exist. Cannot generate duplicates.' });
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
      'SELECT id FROM service_cycles WHERE id = ? AND project_id = ?',
      [cycleId, projectId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Cycle not found' });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE service_cycles SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), cycleId]
    );

    // If marking as completed, auto-activate next cycle
    if (status === 'completed') {
      const [cycle] = await db.query('SELECT cycle_number FROM service_cycles WHERE id = ?', [cycleId]);
      const nextNum = cycle[0].cycle_number + 1;
      await db.query(
        `UPDATE service_cycles SET status = 'active' WHERE project_id = ? AND cycle_number = ? AND status = 'upcoming'`,
        [projectId, nextNum]
      );
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
// Called when current cycle is completed
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

    const cycles = await generateCyclesForProject(projectId, project[0].start_date, 1, req.user.id);
    return res.status(201).json({ message: 'Next cycle generated', cycle: cycles[0] });
  } catch (err) {
    console.error('Generate next cycle error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
