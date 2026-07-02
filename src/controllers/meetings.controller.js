const db = require('../config/db');

/**
 * GET /api/meetings/today-count
 * Returns count of today's scheduled meetings for the current user (for badge)
 */
exports.todayCount = async (req, res) => {
  try {
    let where = 'm.deleted = 0 AND m.meeting_date = CURDATE() AND m.status = "scheduled"';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_members WHERE user_id = ?))';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) AS count FROM meetings m WHERE ${where}`,
      params
    );
    return res.json({ count: rows[0].count });
  } catch (err) {
    console.error('Meetings today count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings
 * List meetings - users only see meetings they are a member of or created. Admin sees all.
 * Supports pagination via ?page=1&limit=20 and status filter via ?status=scheduled
 */
exports.list = async (req, res) => {
  try {
    const { search, status } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const allowedSortFields = { title: 'm.title', meeting_date: 'm.meeting_date', start_time: 'm.start_time' };
    const sortField = allowedSortFields[req.query.sort_by] || 'm.meeting_date';
    const sortDir   = req.query.sort_order === 'ASC' ? 'ASC' : 'DESC';

    let baseWhere = 'm.deleted = 0';
    const baseParams = [];

    if (!req.user.is_admin) {
      baseWhere += ' AND (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_members WHERE user_id = ?))';
      baseParams.push(req.user.id, req.user.id);
    }

    if (search) {
      baseWhere += ' AND (m.title LIKE ? OR m.description LIKE ?)';
      const s = `%${search}%`;
      baseParams.push(s, s);
    }

    // Summary counts (unaffected by status filter)
    const [[summaryRows]] = await db.query(
      `SELECT
         SUM(status = 'scheduled')  AS scheduled,
         SUM(status = 'in_progress') AS in_progress,
         SUM(status = 'completed')  AS completed,
         SUM(status = 'cancelled')  AS cancelled
       FROM meetings m WHERE ${baseWhere}`,
      baseParams
    );
    const summary = {
      scheduled:   parseInt(summaryRows.scheduled  || 0),
      in_progress: parseInt(summaryRows.in_progress || 0),
      completed:   parseInt(summaryRows.completed   || 0),
      cancelled:   parseInt(summaryRows.cancelled   || 0),
    };

    // Apply status filter for paginated results
    let where = baseWhere;
    const params = [...baseParams];
    if (status === 'active') {
      // Default view: only scheduled + in_progress
      where += ` AND m.status IN ('scheduled', 'in_progress')`;
    } else if (status) {
      where += ' AND m.status = ?';
      params.push(status);
    } else {
      // No filter passed — default to active only
      where += ` AND m.status IN ('scheduled', 'in_progress')`;
    }

    // Count query
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM meetings m WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT m.*,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM meetings m
       LEFT JOIN leads l ON l.id = m.client_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE ${where}
       ORDER BY ${sortField} ${sortDir}, m.start_time ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Fetch members for returned meetings
    if (rows.length > 0) {
      const meetingIds = rows.map(r => r.id);
      const [members] = await db.query(
        `SELECT mm.meeting_id, mm.user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS name
         FROM meeting_members mm
         JOIN users u ON u.id = mm.user_id
         WHERE mm.meeting_id IN (?)`,
        [meetingIds]
      );

      const memberMap = {};
      members.forEach(m => {
        if (!memberMap[m.meeting_id]) memberMap[m.meeting_id] = [];
        memberMap[m.meeting_id].push({ user_id: m.user_id, name: m.name });
      });

      rows.forEach(r => {
        r.members = memberMap[r.id] || [];
      });
    }

    return res.json({
      meetings: rows,
      total: parseInt(total),
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary,
    });
  } catch (err) {
    console.error('Meetings list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings/:id
 * Get single meeting detail (only if user is member/creator, or admin)
 */
exports.getOne = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT m.*,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM meetings m
       LEFT JOIN leads l ON l.id = m.client_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.id = ? AND m.deleted = 0`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });

    const meeting = rows[0];

    // Non-admin: check if user is creator or member
    if (!req.user.is_admin && meeting.created_by !== req.user.id) {
      const [memberCheck] = await db.query(
        'SELECT id FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
        [id, req.user.id]
      );
      if (!memberCheck.length) {
        return res.status(403).json({ message: 'You do not have access to this meeting' });
      }
    }

    // Fetch members
    const [members] = await db.query(
      `SELECT mm.user_id, CONCAT(u.first_name, ' ', u.last_name) AS name
       FROM meeting_members mm
       JOIN users u ON u.id = mm.user_id
       WHERE mm.meeting_id = ?`,
      [id]
    );
    meeting.members = members;

    return res.json(meeting);
  } catch (err) {
    console.error('Meeting getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/meetings
 * Create a new meeting
 */
exports.create = async (req, res) => {
  try {
    const {
      title, description, meeting_type, client_id,
      meeting_date, start_time, end_time,
      location_type, meeting_link, mom, member_ids, status
    } = req.body;

    if (!title || !meeting_date || !start_time || !end_time) {
      return res.status(400).json({ message: 'Title, date, start time, and end time are required' });
    }

    const [result] = await db.query(
      `INSERT INTO meetings (title, description, meeting_type, client_id, meeting_date, start_time, end_time, location_type, meeting_link, status, mom, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description || null,
        meeting_type || 'office',
        meeting_type === 'client' ? (client_id || null) : null,
        meeting_date,
        start_time,
        end_time,
        location_type || 'office',
        location_type === 'virtual' ? (meeting_link || null) : null,
        status || 'scheduled',
        mom || null,
        req.user.id
      ]
    );

    const meetingId = result.insertId;

    // Insert members (always include creator)
    const memberSet = new Set(member_ids || []);
    memberSet.add(req.user.id);
    const memberValues = [...memberSet].map(uid => [meetingId, uid]);
    await db.query(
      'INSERT INTO meeting_members (meeting_id, user_id) VALUES ?',
      [memberValues]
    );

    // Fetch the created meeting
    const [rows] = await db.query('SELECT * FROM meetings WHERE id = ?', [meetingId]);
    res.emitSocket('meeting:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Meeting create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/meetings/:id
 * Update a meeting (only creator or admin)
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, meeting_type, client_id,
      meeting_date, start_time, end_time,
      location_type, meeting_link, mom, member_ids, status
    } = req.body;

    const [existing] = await db.query(
      'SELECT id, created_by FROM meetings WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Meeting not found' });

    // Only creator or admin can edit
    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the meeting creator or admin can edit this meeting' });
    }

    await db.query(
      `UPDATE meetings SET
        title = ?, description = ?, meeting_type = ?, client_id = ?,
        meeting_date = ?, start_time = ?, end_time = ?,
        location_type = ?, meeting_link = ?, status = ?, mom = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [
        title,
        description || null,
        meeting_type || 'office',
        meeting_type === 'client' ? (client_id || null) : null,
        meeting_date,
        start_time,
        end_time,
        location_type || 'office',
        location_type === 'virtual' ? (meeting_link || null) : null,
        status || 'scheduled',
        mom || null,
        id
      ]
    );

    // Update members: delete old, insert new (always include creator)
    await db.query('DELETE FROM meeting_members WHERE meeting_id = ?', [id]);
    const memberSet = new Set(member_ids || []);
    memberSet.add(existing[0].created_by);
    const memberValues = [...memberSet].map(uid => [parseInt(id), uid]);
    await db.query(
      'INSERT INTO meeting_members (meeting_id, user_id) VALUES ?',
      [memberValues]
    );

    const [rows] = await db.query('SELECT * FROM meetings WHERE id = ?', [id]);
    res.emitSocket('meeting:updated', rows[0]);
    return res.json(rows[0]);
  } catch (err) {
    console.error('Meeting update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/meetings/:id
 * Soft-delete a meeting (only creator or admin)
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query(
      'SELECT id, created_by FROM meetings WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Meeting not found' });

    // Only creator or admin can delete
    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the meeting creator or admin can delete this meeting' });
    }

    await db.query('UPDATE meetings SET deleted = 1, updated_at = NOW() WHERE id = ?', [id]);
    res.emitSocket('meeting:deleted', { id });
    return res.json({ message: 'Meeting deleted' });
  } catch (err) {
    console.error('Meeting delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TIMER ENDPOINTS (Meeting timer — start/stop like tasks/tickets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/meetings/:id/timer/start
 */
exports.startTimer = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM meetings WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Meeting not found' });

    const meeting = rows[0];

    // Only members or admin can start timer
    if (!req.user.is_admin) {
      const [memberCheck] = await db.query(
        'SELECT 1 FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
        [meeting.id, req.user.id]
      );
      if (memberCheck.length === 0 && meeting.created_by !== req.user.id) {
        return res.status(403).json({ message: 'Only meeting members can track time' });
      }
    }

    if (meeting.status === 'completed' || meeting.status === 'cancelled') {
      return res.status(400).json({ message: 'Cannot start timer on completed/cancelled meetings' });
    }

    // Must be clocked in
    const [attendance] = await db.query(
      `SELECT id, clock_in, clock_out FROM attendance
       WHERE user_id = ? AND date = CURDATE()
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );
    if (attendance.length === 0 || !attendance[0].clock_in) {
      return res.status(400).json({ message: 'You must clock in before starting a meeting timer' });
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

    // Check if user already has a timer running on this meeting
    const [existingTimer] = await db.query(
      'SELECT 1 FROM meeting_active_timers WHERE meeting_id = ? AND user_id = ?',
      [meeting.id, req.user.id]
    );
    if (existingTimer.length > 0) {
      return res.status(400).json({ message: 'Your timer is already running on this meeting' });
    }

    // ── One active timer per user across tasks, tickets, AND meetings ─────
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
       WHERE tat.user_id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (runningTicket.length > 0) {
      return res.status(400).json({
        message: `You already have a timer running on ticket "${runningTicket[0].title}". Stop it first.`,
        conflicting_ticket_id: runningTicket[0].ticket_id,
      });
    }

    const [runningMeeting] = await db.query(
      `SELECT mat.meeting_id, m.title
       FROM meeting_active_timers mat
       JOIN meetings m ON m.id = mat.meeting_id
       WHERE mat.user_id = ? AND mat.meeting_id != ?
       LIMIT 1`,
      [req.user.id, meeting.id]
    );
    if (runningMeeting.length > 0) {
      return res.status(400).json({
        message: `You already have a timer running on meeting "${runningMeeting[0].title}". Stop it first.`,
        conflicting_meeting_id: runningMeeting[0].meeting_id,
      });
    }
    // ──────────────────────────────────────────────────────────────────────

    const now = new Date();

    await db.query(
      'INSERT INTO meeting_active_timers (meeting_id, user_id, started_at) VALUES (?, ?, ?)',
      [meeting.id, req.user.id, now]
    );

    // Update legacy timer_started_at
    if (!meeting.timer_started_at) {
      await db.query('UPDATE meetings SET timer_started_at = ? WHERE id = ?', [now, meeting.id]);
    }

    // Auto-change status to in_progress if currently scheduled
    if (meeting.status === 'scheduled') {
      await db.query('UPDATE meetings SET status = ? WHERE id = ?', ['in_progress', meeting.id]);
    }

    return res.json({ timer_started_at: now, status: meeting.status === 'scheduled' ? 'in_progress' : meeting.status });
  } catch (err) {
    console.error('Meeting startTimer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/meetings/:id/timer/stop
 */
exports.stopTimer = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM meetings WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Meeting not found' });

    const meeting = rows[0];
    const { note } = req.body;

    // Check if user has an active timer on this meeting
    const [activeTimer] = await db.query(
      'SELECT * FROM meeting_active_timers WHERE meeting_id = ? AND user_id = ?',
      [meeting.id, req.user.id]
    );
    if (activeTimer.length === 0) {
      return res.status(400).json({ message: 'No active timer found for this meeting' });
    }

    const timer = activeTimer[0];
    const now = new Date();
    const startedAt = new Date(timer.started_at);
    const durationSec = Math.max(1, Math.floor((now - startedAt) / 1000));

    // Save time log
    await db.query(
      `INSERT INTO meeting_time_logs (meeting_id, user_id, started_at, ended_at, duration, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [meeting.id, req.user.id, timer.started_at, now, durationSec, note || null]
    );

    // Remove active timer
    await db.query(
      'DELETE FROM meeting_active_timers WHERE meeting_id = ? AND user_id = ?',
      [meeting.id, req.user.id]
    );

    // Update total_time_seconds on meeting + append note to MOM
    await db.query(
      'UPDATE meetings SET total_time_seconds = total_time_seconds + ? WHERE id = ?',
      [durationSec, meeting.id]
    );

    // Append stop note to the meeting's MOM field
    if (note && note.trim()) {
      const existingMom = meeting.mom || '';
      const newMom = existingMom
        ? `${existingMom}\n\n${note.trim()}`
        : note.trim();
      await db.query(
        'UPDATE meetings SET mom = ? WHERE id = ?',
        [newMom, meeting.id]
      );
    }

    // If no more active timers, clear legacy timer_started_at + auto-complete if in_progress
    const [remaining] = await db.query(
      'SELECT 1 FROM meeting_active_timers WHERE meeting_id = ?',
      [meeting.id]
    );
    if (remaining.length === 0) {
      await db.query('UPDATE meetings SET timer_started_at = NULL WHERE id = ?', [meeting.id]);

      // Auto-complete: if still in_progress and no timers left, mark as completed
      if (meeting.status === 'in_progress') {
        await db.query('UPDATE meetings SET status = ? WHERE id = ?', ['completed', meeting.id]);
      }
    }

    // Fetch updated meeting
    const [updated] = await db.query('SELECT * FROM meetings WHERE id = ?', [meeting.id]);

    return res.json({
      message: 'Timer stopped & saved',
      total_time_seconds: updated[0].total_time_seconds,
      duration: durationSec,
      timer_started_at: null,
      status: updated[0].status,
    });
  } catch (err) {
    console.error('Meeting stopTimer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings/:id/timer/status
 * Returns current user's timer + all active timers on this meeting
 */
exports.timerStatus = async (req, res) => {
  try {
    const meetingId = req.params.id;

    // Current user's timer
    const [myTimerRows] = await db.query(
      'SELECT * FROM meeting_active_timers WHERE meeting_id = ? AND user_id = ?',
      [meetingId, req.user.id]
    );

    // All active timers on this meeting
    const [activeTimers] = await db.query(
      `SELECT mat.user_id, mat.started_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM meeting_active_timers mat
       JOIN users u ON u.id = mat.user_id
       WHERE mat.meeting_id = ?`,
      [meetingId]
    );

    // Get meeting total
    const [meetingRows] = await db.query(
      'SELECT total_time_seconds, timer_started_at FROM meetings WHERE id = ?',
      [meetingId]
    );

    return res.json({
      my_timer: myTimerRows.length > 0 ? myTimerRows[0] : null,
      active_timers: activeTimers,
      total_time_seconds: meetingRows[0]?.total_time_seconds || 0,
      timer_started_at: meetingRows[0]?.timer_started_at || null,
    });
  } catch (err) {
    console.error('Meeting timerStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings/:id/timer/logs
 * Returns time logs for a meeting
 */
exports.timerLogs = async (req, res) => {
  try {
    const meetingId = req.params.id;

    const [logs] = await db.query(
      `SELECT mtl.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM meeting_time_logs mtl
       JOIN users u ON u.id = mtl.user_id
       WHERE mtl.meeting_id = ?
       ORDER BY mtl.started_at DESC`,
      [meetingId]
    );

    return res.json({ logs });
  } catch (err) {
    console.error('Meeting timerLogs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings/my-active-timer
 * Returns the current user's active meeting timer (if any) — for header indicator
 */
exports.getMyActiveTimer = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mat.meeting_id, mat.started_at, m.title AS meeting_title
       FROM meeting_active_timers mat
       JOIN meetings m ON m.id = mat.meeting_id
       WHERE mat.user_id = ?
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
      meeting_id: rows[0].meeting_id,
      meeting_title: rows[0].meeting_title,
      started_at: rows[0].started_at,
    });
  } catch (err) {
    console.error('my-active-meeting-timer error:', err);
    return res.json({ active: false });
  }
};
