const { validationResult } = require('express-validator');
const db = require('../config/db');

/**
 * GET /api/tickets
 */
exports.list = async (req, res) => {
  try {
    const { mode, status, priority, ticket_type, related_to_type, search } = req.query;
    let where = 't.deleted = 0';
    const params = [];

    if (mode) { where += ' AND t.mode = ?'; params.push(mode); }
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (priority) { where += ' AND t.priority = ?'; params.push(priority); }
    if (ticket_type) { where += ' AND t.ticket_type = ?'; params.push(ticket_type); }
    if (related_to_type) { where += ' AND t.related_to_type = ?'; params.push(related_to_type); }
    if (search) {
      where += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    // Non-admin: only see tickets assigned to or reported by them
    if (!req.user.is_admin) {
      where += ' AND (t.assigned_to = ? OR t.reported_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    // Hide tickets that fall within a paused or skipped cycle's date range — applies to ALL
    // users (incl. admin) on the Tickets list page. Admins can still open them
    // via the cycle detail view.
    where += ` AND NOT (
      t.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM service_cycles sc_pause
        WHERE sc_pause.project_id = t.project_id AND sc_pause.status IN ('paused', 'skipped')
          AND sc_pause.start_date <= COALESCE(t.due_date, t.created_at)
          AND sc_pause.end_date >= COALESCE(t.due_date, t.created_at)
      )
    )`;

    const [rows] = await db.query(
      `SELECT t.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_reported.first_name, ' ', u_reported.last_name) AS reported_by_name,
              p.title AS project_title,
              cl.business_name AS client_brand_name
       FROM tickets t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN users u_reported ON u_reported.id = t.reported_by
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN leads cl ON cl.id = t.related_to_id AND t.related_to_type = 'client'
       WHERE ${where}
       ORDER BY t.created_at DESC`,
      params
    );

    // Summary counts
    const summary = {
      total: rows.length,
      open: rows.filter(r => r.status === 'open').length,
      in_progress: rows.filter(r => r.status === 'in_progress').length,
      hold: rows.filter(r => r.status === 'hold').length,
      pending_done: rows.filter(r => r.status === 'pending_done').length,
      resolved: rows.filter(r => r.status === 'resolved').length,
      closed: rows.filter(r => r.status === 'closed').length,
    };

    return res.json({ tickets: rows, summary });
  } catch (err) {
    console.error('Tickets list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tickets/stats
 */
exports.stats = async (req, res) => {
  try {
    let where = 't.deleted = 0';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND (t.assigned_to = ? OR t.reported_by = ?)';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN t.status = 'hold' THEN 1 ELSE 0 END) as hold_count,
        SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) as closed_count,
        SUM(CASE WHEN t.due_date < CURDATE() AND t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN t.priority = 'critical' AND t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as critical_count
       FROM tickets t
       WHERE ${where}`,
      params
    );

    // Average resolution time (in hours)
    const [avgRes] = await db.query(
      `SELECT AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at)) as avg_resolution_hours
       FROM tickets t
       WHERE t.deleted = 0 AND t.resolved_at IS NOT NULL`,
      []
    );

    return res.json({
      ...rows[0],
      avg_resolution_hours: Math.round(avgRes[0]?.avg_resolution_hours || 0),
    });
  } catch (err) {
    console.error('Tickets stats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tickets/my-active-timer
 * Returns the current user's active ticket timer (if any)
 */
exports.getMyActiveTimer = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT tat.ticket_id, tat.started_at, t.title AS ticket_title
       FROM ticket_active_timers tat
       JOIN tickets t ON t.id = tat.ticket_id
       WHERE tat.user_id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.json({ active: false });
    }

    // Check if AFS is currently active (timer should show as paused)
    const [activeAfs] = await db.query(
      'SELECT id FROM afs_logs WHERE user_id = ? AND end_time IS NULL LIMIT 1',
      [req.user.id]
    );
    const paused = activeAfs.length > 0;

    return res.json({
      active: true,
      paused,
      ticket_id: rows[0].ticket_id,
      ticket_title: rows[0].ticket_title,
      started_at: rows[0].started_at,
    });
  } catch (err) {
    console.error('my-active-ticket-timer error:', err);
    return res.json({ active: false });
  }
};

/**
 * GET /api/tickets/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_reported.first_name, ' ', u_reported.last_name) AS reported_by_name,
              p.title AS project_title,
              cl.business_name AS client_brand_name,
              cl.name AS client_name
       FROM tickets t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN users u_reported ON u_reported.id = t.reported_by
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN leads cl ON cl.id = t.related_to_id AND t.related_to_type = 'client'
       WHERE t.id = ? AND t.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    // Non-admin access check
    if (!req.user.is_admin && ticket.assigned_to !== req.user.id && ticket.reported_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // If ticket belongs to a paused or skipped cycle, non-admin users cannot view it
    if (!req.user.is_admin && ticket.project_id) {
      const ticketDate = ticket.due_date || ticket.created_at;
      const [pausedCycle] = await db.query(
        `SELECT id FROM service_cycles
         WHERE project_id = ? AND status IN ('paused', 'skipped')
           AND start_date <= ? AND end_date >= ?
         LIMIT 1`,
        [ticket.project_id, ticketDate, ticketDate]
      );
      if (pausedCycle.length > 0) {
        return res.status(403).json({ message: 'This ticket belongs to a paused or skipped cycle and is not accessible.' });
      }
    }

    // Fetch attachments
    const [attachments] = await db.query(
      `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM ticket_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.ticket_id = ?
       ORDER BY a.created_at DESC`,
      [ticket.id]
    );
    ticket.attachments = attachments;

    // Fetch activity log
    const [activities] = await db.query(
      `SELECT al.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ticket_activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.ticket_id = ?
       ORDER BY al.created_at DESC`,
      [ticket.id]
    );
    ticket.activities = activities;

    // Fetch time logs (for work mode)
    if (ticket.mode === 'work') {
      const [timeLogs] = await db.query(
        `SELECT tl.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
         FROM ticket_time_logs tl
         LEFT JOIN users u ON u.id = tl.user_id
         WHERE tl.ticket_id = ?
         ORDER BY tl.log_date DESC`,
        [ticket.id]
      );
      ticket.time_logs = timeLogs;
    }

    // If related to employee, fetch employee name
    if (ticket.related_to_type === 'employee' && ticket.related_to_id) {
      const [emp] = await db.query(
        `SELECT id, first_name, last_name, department FROM users WHERE id = ?`,
        [ticket.related_to_id]
      );
      if (emp.length > 0) {
        ticket.related_employee_name = `${emp[0].first_name} ${emp[0].last_name}`;
        ticket.related_employee_department = emp[0].department;
      }
    }

    return res.json(ticket);
  } catch (err) {
    console.error('Ticket getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    mode, title, description, ticket_type, priority, status,
    related_to_type, related_to_id, vendor_name, brand_id, project_id,
    assigned_to, due_date, internal_notes
  } = req.body;

  // Helper: convert empty strings to null (multipart/form-data sends everything as strings)
  const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;
  const toInt = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

  try {
    // Generate ticket_id_code: TKT-YYMM-CLIENT-###
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const ymPrefix = `${yy}${mm}`;

    // Get client code from brand_id (which references leads table)
    let clientCode = 'GEN';
    if (brand_id) {
      const [clientRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [parseInt(brand_id)]);
      if (clientRows.length > 0 && clientRows[0].client_code) {
        clientCode = clientRows[0].client_code;
      }
    }
    const ticketPrefix = `TKT-${ymPrefix}-${clientCode}`;
    const [lastTicket] = await db.query(
      `SELECT ticket_id_code FROM tickets WHERE ticket_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
      [`${ticketPrefix}-%`]
    );
    let ticketSeq = 1;
    if (lastTicket.length > 0 && lastTicket[0].ticket_id_code) {
      const parts = lastTicket[0].ticket_id_code.split('-');
      ticketSeq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    const ticket_id_code = `${ticketPrefix}-${String(ticketSeq).padStart(3, '0')}`;

    const [result] = await db.query(
      `INSERT INTO tickets (ticket_id_code, mode, title, description, ticket_type, priority, status,
        related_to_type, related_to_id, vendor_name, brand_id, project_id,
        assigned_to, reported_by, due_date, internal_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticket_id_code,
        mode || 'support', title, toNull(description),
        ticket_type || 'General Request', priority || 'medium', status || 'open',
        toNull(related_to_type), toInt(related_to_id), toNull(vendor_name),
        toInt(brand_id), toInt(project_id),
        toInt(assigned_to), req.user.id, toNull(due_date), toNull(internal_notes)
      ]
    );

    const ticketId = result.insertId;

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, new_value)
       VALUES (?, ?, 'created', 'Ticket created')`,
      [ticketId, req.user.id]
    );

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      const fileValues = req.files.map(f => [
        ticketId, f.path.replace(/\\/g, '/'), f.originalname, f.mimetype, req.user.id
      ]);
      await db.query(
        'INSERT INTO ticket_attachments (ticket_id, file_path, file_name, file_type, uploaded_by) VALUES ?',
        [fileValues]
      );
    }

    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    res.emitSocket('tickets:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Ticket create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/tickets/:id
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    // Closed tickets cannot be edited
    if (ticket.status === 'closed') {
      return res.status(403).json({ message: 'Closed tickets cannot be edited' });
    }

    // If ticket belongs to a paused or skipped cycle (by project + date range), only admin can edit
    if (!req.user.is_admin && ticket.project_id) {
      const ticketDate = ticket.due_date || ticket.created_at;
      const [pausedCycle] = await db.query(
        `SELECT id FROM service_cycles
         WHERE project_id = ? AND status IN ('paused', 'skipped')
           AND start_date <= ? AND end_date >= ?
         LIMIT 1`,
        [ticket.project_id, ticketDate, ticketDate]
      );
      if (pausedCycle.length > 0) {
        return res.status(403).json({ message: 'This ticket belongs to a paused or skipped cycle. Only admins can edit it.' });
      }
    }

    if (!req.user.is_admin && ticket.reported_by !== req.user.id) {
      // Assigned member can ONLY update status and resolution_summary
      if (ticket.assigned_to === req.user.id) {
        const assigneeAllowed = ['status', 'resolution_summary'];
        const attemptedFields = Object.keys(req.body).filter(k => req.body[k] !== undefined && req.body[k] !== '');
        const disallowed = attemptedFields.filter(f => !assigneeAllowed.includes(f));
        if (disallowed.length > 0) {
          return res.status(403).json({ message: 'Assigned members can only update status and resolution summary' });
        }
      } else {
        return res.status(403).json({ message: 'Only the ticket creator or admin can edit this ticket' });
      }
    }

    const allowed = [
      'mode', 'title', 'description', 'ticket_type', 'priority', 'status',
      'related_to_type', 'related_to_id', 'vendor_name', 'brand_id', 'project_id',
      'assigned_to', 'due_date', 'internal_notes', 'resolution_summary'
    ];

    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Track status change
    if (updates.status && updates.status !== ticket.status) {
      await db.query(
        `INSERT INTO ticket_activity_log (ticket_id, user_id, action, old_value, new_value)
         VALUES (?, ?, 'status_change', ?, ?)`,
        [ticket.id, req.user.id, ticket.status, updates.status]
      );

      // Set resolved_at / closed_at timestamps
      if (updates.status === 'resolved') {
        updates.resolved_at = new Date();
      } else if (updates.status === 'closed') {
        updates.closed_at = new Date();
      }
    }

    // Track assignment change
    if (updates.assigned_to && updates.assigned_to !== ticket.assigned_to) {
      const [newUser] = await db.query(
        `SELECT CONCAT(first_name, ' ', last_name) as name FROM users WHERE id = ?`,
        [updates.assigned_to]
      );
      await db.query(
        `INSERT INTO ticket_activity_log (ticket_id, user_id, action, old_value, new_value)
         VALUES (?, ?, 'assignment', ?, ?)`,
        [ticket.id, req.user.id, ticket.assigned_to ? String(ticket.assigned_to) : 'Unassigned', newUser[0]?.name || String(updates.assigned_to)]
      );
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id];
    await db.query(`UPDATE tickets SET ${setClauses} WHERE id = ?`, values);

    // Handle new file uploads
    if (req.files && req.files.length > 0) {
      const fileValues = req.files.map(f => [
        ticket.id, f.path.replace(/\\/g, '/'), f.originalname, f.mimetype, req.user.id
      ]);
      await db.query(
        'INSERT INTO ticket_attachments (ticket_id, file_path, file_name, file_type, uploaded_by) VALUES ?',
        [fileValues]
      );
    }

    const [updated] = await db.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    res.emitSocket('tickets:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Ticket update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/tickets/:id (soft delete)
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];
    if (!req.user.is_admin && ticket.reported_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the reporter or admin can delete this ticket' });
    }

    await db.query('UPDATE tickets SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('tickets:deleted', { id: req.params.id });
    return res.json({ message: 'Ticket deleted' });
  } catch (err) {
    console.error('Ticket delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/comments
 */
exports.addComment = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const { comment } = req.body;

    const [result] = await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, comment)
       VALUES (?, ?, 'comment', ?)`,
      [req.params.id, req.user.id, comment]
    );

    const [activity] = await db.query(
      `SELECT al.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ticket_activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(activity[0]);
  } catch (err) {
    console.error('Ticket comment error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/time-logs
 */
exports.addTimeLog = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    if (rows[0].mode !== 'work') {
      return res.status(400).json({ message: 'Time logging is only available for Work mode tickets' });
    }

    const { minutes, description, log_date } = req.body;

    const [result] = await db.query(
      `INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, description, log_date)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, req.user.id, minutes, description || null, log_date || new Date().toISOString().split('T')[0]]
    );

    // Update total time on ticket
    await db.query(
      `UPDATE tickets SET total_time_minutes = total_time_minutes + ? WHERE id = ?`,
      [minutes, req.params.id]
    );

    // Log activity
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, new_value, comment)
       VALUES (?, ?, 'time_log', ?, ?)`,
      [req.params.id, req.user.id, timeStr, description || null]
    );

    const [timeLog] = await db.query(
      `SELECT tl.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ticket_time_logs tl
       LEFT JOIN users u ON u.id = tl.user_id
       WHERE tl.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(timeLog[0]);
  } catch (err) {
    console.error('Ticket time log error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TIMER ENDPOINTS (Work mode — start/stop like tasks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/tickets/:id/timer/start
 */
exports.startTimer = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    if (ticket.mode !== 'work') {
      return res.status(400).json({ message: 'Timer is only available for Work mode tickets' });
    }

    // Only assigned user or admin can start timer
    if (!req.user.is_admin && ticket.assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Only the assigned user can track time on this ticket' });
    }

    if (['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ message: 'Cannot start timer on resolved/closed tickets' });
    }

    // Must be clocked in
    const [attendance] = await db.query(
      `SELECT id, clock_in, clock_out FROM attendance
       WHERE user_id = ? AND date = CURDATE()
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );
    if (attendance.length === 0 || !attendance[0].clock_in) {
      return res.status(400).json({ message: 'You must clock in before starting a ticket timer' });
    }
    if (attendance[0].clock_out) {
      return res.status(400).json({ message: 'You have already clocked out. Timer cannot be started after clock out.' });
    }

    // Block timer during AFS
    const [activeAfs] = await db.query(
      'SELECT id FROM afs_logs WHERE user_id = ? AND end_time IS NULL LIMIT 1',
      [req.user.id]
    );
    if (activeAfs.length > 0) {
      return res.status(400).json({ message: 'Cannot start timer while AFS is active. End your AFS break first.' });
    }

    // Check if user already has a timer running on this ticket
    const [existingTimer] = await db.query(
      'SELECT 1 FROM ticket_active_timers WHERE ticket_id = ? AND user_id = ?',
      [ticket.id, req.user.id]
    );
    if (existingTimer.length > 0) {
      return res.status(400).json({ message: 'Your timer is already running on this ticket' });
    }

    // One active timer per user across all tasks AND tickets
    const [runningTask] = await db.query(
      `SELECT tat.task_id, t.title
       FROM task_active_timers tat
       JOIN tasks t ON t.id = tat.task_id
       WHERE tat.user_id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (runningTask.length > 0) {
      return res.status(400).json({
        message: `You already have a timer running on task "${runningTask[0].title}". Stop it first.`,
        conflicting_task_id: runningTask[0].task_id,
      });
    }

    const [runningTicket] = await db.query(
      `SELECT tat.ticket_id, t.title
       FROM ticket_active_timers tat
       JOIN tickets t ON t.id = tat.ticket_id
       WHERE tat.user_id = ? AND tat.ticket_id != ?
       LIMIT 1`,
      [req.user.id, ticket.id]
    );
    if (runningTicket.length > 0) {
      return res.status(400).json({
        message: `You already have a timer running on ticket "${runningTicket[0].title}". Stop it first.`,
        conflicting_ticket_id: runningTicket[0].ticket_id,
      });
    }

    // Block if a meeting timer is running
    const [runningMeeting] = await db.query(
      `SELECT mat.meeting_id, m.title
       FROM meeting_active_timers mat
       JOIN meetings m ON m.id = mat.meeting_id
       WHERE mat.user_id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (runningMeeting.length > 0) {
      return res.status(400).json({
        message: `You already have a timer running on meeting "${runningMeeting[0].title}". Stop it first.`,
        conflicting_meeting_id: runningMeeting[0].meeting_id,
      });
    }

    const now = new Date();

    await db.query(
      'INSERT INTO ticket_active_timers (ticket_id, user_id, started_at) VALUES (?, ?, ?)',
      [ticket.id, req.user.id, now]
    );

    // Update legacy timer_started_at
    if (!ticket.timer_started_at) {
      await db.query('UPDATE tickets SET timer_started_at = ? WHERE id = ?', [now, ticket.id]);
    }

    // Auto-change status to in_progress if currently open
    if (ticket.status === 'open') {
      await db.query('UPDATE tickets SET status = ? WHERE id = ?', ['in_progress', ticket.id]);
    }

    return res.json({ timer_started_at: now, status: ticket.status === 'open' ? 'in_progress' : ticket.status });
  } catch (err) {
    console.error('Ticket startTimer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/timer/stop
 */
exports.stopTimer = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    if (!req.user.is_admin && ticket.assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Only the assigned user can track time on this ticket' });
    }

    // Check if user has an active timer on this ticket
    const [activeTimer] = await db.query(
      'SELECT * FROM ticket_active_timers WHERE ticket_id = ? AND user_id = ?',
      [ticket.id, req.user.id]
    );

    if (activeTimer.length === 0) {
      return res.status(400).json({ message: 'Timer is not running' });
    }

    const timer = activeTimer[0];
    const now = new Date();
    const startedAt = new Date(timer.started_at);
    const durationSec = Math.max(1, Math.floor((now - startedAt) / 1000));
    const durationMin = Math.max(1, Math.round(durationSec / 60));
    const note = req.body.note || null;

    // Save time log entry with both minutes (legacy) and duration (new)
    await db.query(
      `INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, description, log_date, started_at, ended_at, duration)
       VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?)`,
      [ticket.id, req.user.id, durationMin, note, startedAt, now, durationSec]
    );

    // Remove active timer
    await db.query(
      'DELETE FROM ticket_active_timers WHERE ticket_id = ? AND user_id = ?',
      [ticket.id, req.user.id]
    );

    // Update total_time_minutes
    await db.query(
      'UPDATE tickets SET total_time_minutes = total_time_minutes + ? WHERE id = ?',
      [durationMin, ticket.id]
    );

    // If no more active timers, clear legacy timer_started_at
    const [remaining] = await db.query(
      'SELECT 1 FROM ticket_active_timers WHERE ticket_id = ?',
      [ticket.id]
    );
    if (remaining.length === 0) {
      await db.query('UPDATE tickets SET timer_started_at = NULL WHERE id = ?', [ticket.id]);
    }

    // Log activity
    const hours = Math.floor(durationMin / 60);
    const mins = durationMin % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, new_value, comment)
       VALUES (?, ?, 'time_log', ?, ?)`,
      [ticket.id, req.user.id, timeStr, note]
    );

    // Get updated ticket
    const [updated] = await db.query('SELECT total_time_minutes FROM tickets WHERE id = ?', [ticket.id]);

    return res.json({
      total_time_minutes: updated[0].total_time_minutes,
      duration: durationSec,
      timer_started_at: null,
    });
  } catch (err) {
    console.error('Ticket stopTimer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tickets/:id/timer/status
 */
exports.getTimerStatus = async (req, res) => {
  try {
    const [timer] = await db.query(
      'SELECT * FROM ticket_active_timers WHERE ticket_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    const [allTimers] = await db.query(
      `SELECT tat.user_id, tat.started_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ticket_active_timers tat
       JOIN users u ON u.id = tat.user_id
       WHERE tat.ticket_id = ?`,
      [req.params.id]
    );

    return res.json({
      my_timer: timer.length > 0 ? timer[0] : null,
      active_timers: allTimers,
    });
  } catch (err) {
    console.error('Ticket getTimerStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tickets/:id/timer/logs
 * Returns time log entries + active timers for the ticket
 */
exports.getTimerLogs = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    const [logs] = await db.query(
      `SELECT tl.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ticket_time_logs tl
       JOIN users u ON u.id = tl.user_id
       WHERE tl.ticket_id = ?
       ORDER BY tl.created_at DESC`,
      [ticket.id]
    );

    const [activeTimers] = await db.query(
      `SELECT tat.user_id, tat.started_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ticket_active_timers tat
       JOIN users u ON u.id = tat.user_id
       WHERE tat.ticket_id = ?`,
      [ticket.id]
    );

    return res.json({
      logs,
      active_timers: activeTimers,
      total_time_minutes: ticket.total_time_minutes,
      timer_started_at: ticket.timer_started_at,
    });
  } catch (err) {
    console.error('Ticket getTimerLogs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/tickets/:id/attachments/:attachmentId
 */
exports.removeAttachment = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?',
      [req.params.attachmentId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Attachment not found' });

    await db.query('DELETE FROM ticket_attachments WHERE id = ?', [req.params.attachmentId]);
    return res.json({ message: 'Attachment removed' });
  } catch (err) {
    console.error('Ticket remove attachment error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MARK AS DONE / APPROVE / REJECT (like tasks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/tickets/:id/mark-done
 * Assigned user or reporter marks ticket as done → status becomes 'pending_done' (awaiting admin approval)
 */
exports.markDone = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    // Only assigned user, reporter, or admin can mark done
    if (ticket.assigned_to !== req.user.id && ticket.reported_by !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Only the assigned user or reporter can mark this ticket as done' });
    }

    // Must be in a workable state
    if (!['open', 'in_progress', 'hold'].includes(ticket.status)) {
      return res.status(400).json({ message: 'Ticket must be open, in progress, or on hold to mark as done' });
    }

    await db.query(
      "UPDATE tickets SET status = 'pending_done', marked_done_by = ?, marked_done_at = NOW() WHERE id = ?",
      [req.user.id, ticket.id]
    );

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, old_value, new_value, comment)
       VALUES (?, ?, 'status_change', ?, 'pending_done', 'Marked as done — awaiting approval')`,
      [ticket.id, req.user.id, ticket.status]
    );

    const [updated] = await db.query('SELECT * FROM tickets WHERE id = ?', [ticket.id]);
    res.emitSocket('tickets:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Ticket markDone error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/approve-done
 * Admin approves the "mark as done" → status becomes 'resolved'
 */
exports.approveDone = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    if (ticket.status !== 'pending_done') {
      return res.status(400).json({ message: 'Ticket is not pending approval' });
    }

    await db.query(
      "UPDATE tickets SET status = 'resolved', resolved_at = NOW() WHERE id = ?",
      [ticket.id]
    );

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, old_value, new_value, comment)
       VALUES (?, ?, 'status_change', 'pending_done', 'resolved', 'Completion approved by admin')`,
      [ticket.id, req.user.id]
    );

    const [updated] = await db.query('SELECT * FROM tickets WHERE id = ?', [ticket.id]);
    res.emitSocket('tickets:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Ticket approveDone error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/reject-done
 * Admin rejects the "mark as done" → status goes back to 'in_progress'
 */
exports.rejectDone = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    if (ticket.status !== 'pending_done') {
      return res.status(400).json({ message: 'Ticket is not pending approval' });
    }

    const { reason } = req.body;

    await db.query(
      "UPDATE tickets SET status = 'in_progress', marked_done_by = NULL, marked_done_at = NULL WHERE id = ?",
      [ticket.id]
    );

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, old_value, new_value, comment)
       VALUES (?, ?, 'status_change', 'pending_done', 'in_progress', ?)`,
      [ticket.id, req.user.id, reason ? `Rejected: ${reason}` : 'Completion rejected by admin']
    );

    const [updated] = await db.query('SELECT * FROM tickets WHERE id = ?', [ticket.id]);
    res.emitSocket('tickets:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Ticket rejectDone error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DEADLINE EXTENSION REQUESTS (for tickets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/tickets/:id/extension-request
 * Assigned user or reporter requests a deadline extension
 */
exports.createExtensionRequest = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tickets WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = rows[0];

    // Only assigned user, reporter, or admin can request extension
    if (ticket.assigned_to !== req.user.id && ticket.reported_by !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Only the assigned user or reporter can request an extension' });
    }

    // Must be in a workable state
    if (['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ message: 'Cannot request extension for resolved/closed tickets' });
    }

    const { requested_deadline, reason } = req.body;

    if (!requested_deadline) {
      return res.status(400).json({ message: 'Requested deadline is required' });
    }
    if (!reason) {
      return res.status(400).json({ message: 'Reason is required' });
    }

    // Block duplicate pending extension
    const [existing] = await db.query(
      "SELECT id FROM ticket_deadline_extension_requests WHERE ticket_id = ? AND status = 'pending' AND deleted = 0",
      [ticket.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'A pending extension request already exists for this ticket' });
    }

    const [result] = await db.query(
      'INSERT INTO ticket_deadline_extension_requests (ticket_id, requested_by, requested_deadline, reason) VALUES (?, ?, ?, ?)',
      [ticket.id, req.user.id, requested_deadline, reason]
    );

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, new_value, comment)
       VALUES (?, ?, 'extension_requested', ?, ?)`,
      [ticket.id, req.user.id, requested_deadline, `Requested new deadline: ${reason}`]
    );

    const [ext] = await db.query(
      `SELECT er.*, t.title AS ticket_title,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM ticket_deadline_extension_requests er
       LEFT JOIN tickets t ON t.id = er.ticket_id
       LEFT JOIN users u ON u.id = er.requested_by
       WHERE er.id = ?`,
      [result.insertId]
    );

    res.emitSocket('tickets:extension_requested', ext[0]);
    return res.status(201).json(ext[0]);
  } catch (err) {
    console.error('Ticket createExtensionRequest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/extension-request/:extId/approve  (admin)
 */
exports.approveExtensionRequest = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM ticket_deadline_extension_requests WHERE id = ? AND ticket_id = ? AND deleted = 0',
      [req.params.extId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extension request not found' });

    const ext = rows[0];
    if (ext.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    // Update request status
    await db.query(
      "UPDATE ticket_deadline_extension_requests SET status = 'approved', actioned_by = ? WHERE id = ?",
      [req.user.id, ext.id]
    );

    // Update ticket due_date
    await db.query(
      'UPDATE tickets SET due_date = ? WHERE id = ?',
      [ext.requested_deadline, ext.ticket_id]
    );

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, new_value, comment)
       VALUES (?, ?, 'extension_approved', ?, 'Deadline extension approved')`,
      [ext.ticket_id, req.user.id, ext.requested_deadline]
    );

    res.emitSocket('tickets:extension_approved', { ticket_id: ext.ticket_id, new_due_date: ext.requested_deadline });
    return res.json({ message: 'Extension approved', new_due_date: ext.requested_deadline });
  } catch (err) {
    console.error('Ticket approveExtensionRequest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tickets/:id/extension-request/:extId/reject  (admin)
 */
exports.rejectExtensionRequest = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM ticket_deadline_extension_requests WHERE id = ? AND ticket_id = ? AND deleted = 0',
      [req.params.extId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extension request not found' });

    const ext = rows[0];
    if (ext.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    await db.query(
      "UPDATE ticket_deadline_extension_requests SET status = 'rejected', actioned_by = ? WHERE id = ?",
      [req.user.id, ext.id]
    );

    // Log activity
    await db.query(
      `INSERT INTO ticket_activity_log (ticket_id, user_id, action, comment)
       VALUES (?, ?, 'extension_rejected', 'Deadline extension rejected')`,
      [ext.ticket_id, req.user.id]
    );

    res.emitSocket('tickets:extension_rejected', { ticket_id: ext.ticket_id });
    return res.json({ message: 'Extension rejected' });
  } catch (err) {
    console.error('Ticket rejectExtensionRequest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/tickets/:id/extension-request/:extId/cancel
 * Requester cancels their own pending extension request
 */
exports.cancelExtensionRequest = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM ticket_deadline_extension_requests WHERE id = ? AND ticket_id = ? AND deleted = 0',
      [req.params.extId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extension request not found' });

    const ext = rows[0];

    if (ext.requested_by !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'You can only cancel your own requests' });
    }

    if (ext.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    await db.query(
      'UPDATE ticket_deadline_extension_requests SET deleted = 1 WHERE id = ?',
      [ext.id]
    );

    return res.json({ message: 'Extension request cancelled' });
  } catch (err) {
    console.error('Ticket cancelExtensionRequest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tickets/:id/extension-requests
 * Get all extension requests for a ticket
 */
exports.getExtensionRequests = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT er.*, CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name,
              CONCAT(a.first_name, ' ', a.last_name) AS actioned_by_name
       FROM ticket_deadline_extension_requests er
       LEFT JOIN users u ON u.id = er.requested_by
       LEFT JOIN users a ON a.id = er.actioned_by
       WHERE er.ticket_id = ? AND er.deleted = 0
       ORDER BY er.created_at DESC`,
      [req.params.id]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Ticket getExtensionRequests error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
