const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

/**
 * GET /api/users
 * Returns all active, non-deleted users (for forward task dropdown etc.)
 */
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, first_name, last_name, email, is_admin
       FROM users
       WHERE deleted = 0 AND is_active = 1
       ORDER BY first_name, last_name`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Users list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me
 */
exports.me = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.avatar_url,
              u.blood_group, u.gender, u.date_of_birth, u.address,
              u.department, u.designation, u.date_of_joining, u.reporting_to,
              u.is_admin, u.created_at, u.last_login_at,
              r.name AS role_name,
              CONCAT(mgr.first_name, ' ', mgr.last_name) AS reporting_to_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN users mgr ON mgr.id = u.reporting_to AND mgr.deleted = 0
       WHERE u.id = ? AND u.deleted = 0`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/users/me
 * Update current user's profile
 */
exports.updateMe = async (req, res) => {
  try {
    const { phone, blood_group, gender, date_of_birth, address, department, designation } = req.body;
    await db.query(
      `UPDATE users SET phone = ?, blood_group = ?, gender = ?, date_of_birth = ?, address = ?,
       department = ?, designation = ?, updated_at = NOW() WHERE id = ?`,
      [phone || '', blood_group || '', gender || '', date_of_birth || null, address || null,
       department || '', designation || '', req.user.id]
    );
    return res.json({ message: 'Profile updated' });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/users/me/avatar
 * Upload avatar image
 */
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Delete old avatar from Cloudinary
    const [current] = await db.query('SELECT avatar_url FROM users WHERE id = ?', [req.user.id]);
    if (current[0]?.avatar_url) {
      const oldPublicId = extractPublicId(current[0].avatar_url);
      if (oldPublicId) await deleteFromCloudinary(oldPublicId, 'image');
    }

    const { url } = await uploadToCloudinary(req.file.buffer, 'crm/avatars', 'image');
    await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [url, req.user.id]);

    return res.json({ message: 'Avatar uploaded', url });
  } catch (err) {
    console.error('Upload avatar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/users/me/avatar
 * Remove avatar
 */
exports.removeAvatar = async (req, res) => {
  try {
    const [current] = await db.query('SELECT avatar_url FROM users WHERE id = ?', [req.user.id]);
    if (current[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '../../', current[0].avatar_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await db.query("UPDATE users SET avatar_url = '' WHERE id = ?", [req.user.id]);
    return res.json({ message: 'Avatar removed' });
  } catch (err) {
    console.error('Remove avatar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/users/me/password
 * Change current user's password
 */
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'Both current and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ? AND deleted = 0', [req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found' });

    const bcrypt = require('bcryptjs');
    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = ?, password_changed_at = NOW(), updated_at = NOW() WHERE id = ?', [hash, req.user.id]);

    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/permissions
 * Returns the current user's role permissions.
 */
exports.myPermissions = async (req, res) => {
  try {
    if (req.user.is_admin) {
      const modules = ['dashboard','projects','tasks','tickets','meetings','creative_hub','people_ops','clients','revenue','finance','playbook','reports','settings'];
      const perms = modules.reduce((acc, m) => {
        acc[m] = { can_view: 2, can_create: 1, can_edit: 2, can_delete: 1 };
        return acc;
      }, {});

      // Try to fetch responsibilities from Admin role or user's assigned role
      let responsibilities = null;
      const [adminUser] = await db.query('SELECT role_id FROM users WHERE id = ? AND deleted = 0', [req.user.id]);
      const roleId = adminUser[0]?.role_id;
      if (roleId) {
        const [roleRows] = await db.query('SELECT responsibilities FROM roles WHERE id = ?', [roleId]);
        responsibilities = roleRows[0]?.responsibilities || null;
      }
      if (!responsibilities) {
        // Fallback: check the system "Admin" role
        const [adminRole] = await db.query("SELECT responsibilities FROM roles WHERE name = 'Admin' AND is_system = 1 LIMIT 1");
        responsibilities = adminRole[0]?.responsibilities || null;
      }

      return res.json({ is_admin: true, role_id: roleId || null, role_name: 'Admin', responsibilities, permissions: perms });
    }

    const [userRows] = await db.query(
      'SELECT role_id FROM users WHERE id = ? AND deleted = 0',
      [req.user.id]
    );
    if (!userRows.length) return res.status(404).json({ message: 'User not found' });

    const roleId = userRows[0].role_id;

    if (!roleId) {
      return res.json({ is_admin: false, role_id: null, role_name: null, permissions: {} });
    }

    const [roleRows] = await db.query('SELECT name, responsibilities FROM roles WHERE id = ?', [roleId]);
    const roleName = roleRows[0]?.name || null;
    const responsibilities = roleRows[0]?.responsibilities || null;

    const [permRows] = await db.query(
      'SELECT module, can_view, can_create, can_edit, can_delete FROM role_permissions WHERE role_id = ?',
      [roleId]
    );

    const permissions = permRows.reduce((acc, p) => {
      acc[p.module] = {
        can_view:   p.can_view,
        can_create: p.can_create,
        can_edit:   p.can_edit,
        can_delete: p.can_delete,
      };
      return acc;
    }, {});

    return res.json({ is_admin: false, role_id: roleId, role_name: roleName, responsibilities, permissions });
  } catch (err) {
    console.error('myPermissions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/projects
 * Get projects the user is a member of
 */
exports.myProjects = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.title, p.status, p.start_date, p.end_date
       FROM projects p
       INNER JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ? AND p.deleted = 0
       ORDER BY p.updated_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('My projects error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/tasks
 * Get tasks assigned to the user
 */
exports.myTasks = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, status, priority, deadline, is_active
       FROM tasks
       WHERE assigned_to = ? AND deleted = 0
       ORDER BY FIELD(status, 'in_progress', 'to_do', 'done'), deadline ASC
       LIMIT 50`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('My tasks error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/leaves
 * Get user's leave history
 */
exports.myLeaves = async (req, res) => {
  try {
    const [leaves] = await db.query(
      `SELECT l.*, CONCAT(a.first_name, ' ', a.last_name) AS approved_by_name
       FROM leaves l
       LEFT JOIN users a ON a.id = l.approved_by
       WHERE l.user_id = ? AND l.deleted = 0
       ORDER BY l.from_date DESC`,
      [req.user.id]
    );
    const [balances] = await db.query(
      `SELECT leave_type, total, used FROM leave_balances WHERE user_id = ? AND year = YEAR(CURDATE())`,
      [req.user.id]
    );
    return res.json({ leaves, balances });
  } catch (err) {
    console.error('My leaves error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/users/me/leaves
 * Apply for leave
 */
exports.applyLeave = async (req, res) => {
  try {
    const { leave_type, from_date, to_date, reason } = req.body;
    if (!leave_type || !from_date || !to_date || !reason) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const start = new Date(from_date);
    const end = new Date(to_date);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (days <= 0) return res.status(400).json({ message: 'Invalid date range' });

    const [result] = await db.query(
      `INSERT INTO leaves (user_id, leave_type, from_date, to_date, days, reason) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, leave_type, from_date, to_date, days, reason]
    );

    return res.status(201).json({ message: 'Leave applied', id: result.insertId });
  } catch (err) {
    console.error('Apply leave error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/users/me/leaves/:id
 * Cancel a pending leave
 */
exports.cancelLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT * FROM leaves WHERE id = ? AND user_id = ? AND deleted = 0',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Leave not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only pending leaves can be cancelled' });
    }

    await db.query("UPDATE leaves SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [id]);
    return res.json({ message: 'Leave cancelled' });
  } catch (err) {
    console.error('Cancel leave error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/:id/employment
 * Get employment status + probation info for an employee (admin only)
 */
exports.getEmployment = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, first_name, last_name, employment_status, probation_end_date, date_of_joining
       FROM users WHERE id = ? AND deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'User not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('getEmployment error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/users/:id/employment
 * Update employment_status and probation_end_date (admin only)
 */
exports.updateEmployment = async (req, res) => {
  try {
    const { employment_status, probation_end_date } = req.body;
    const [rows] = await db.query('SELECT id FROM users WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'User not found' });

    await db.query(
      `UPDATE users SET employment_status = ?, probation_end_date = ?, updated_at = NOW() WHERE id = ?`,
      [
        employment_status || 'probation',
        probation_end_date || null,
        req.params.id,
      ]
    );
    return res.json({ message: 'Employment status updated' });
  } catch (err) {
    console.error('updateEmployment error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/:id/leave-balance
 * Get paid leave ledger for an employee (admin only)
 */
exports.getLeaveBalance = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pll.*
       FROM paid_leave_ledger pll
       WHERE pll.employee_id = ?
       ORDER BY pll.ledger_year DESC, pll.ledger_month DESC
       LIMIT 12`,
      [req.params.id]
    );

    // Current balance = latest closing_balance
    const currentBalance = rows.length > 0 ? parseFloat(rows[0].closing_balance) : 0;

    return res.json({ ledger: rows, current_balance: currentBalance });
  } catch (err) {
    console.error('getLeaveBalance error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCED PROFILE FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/users/me/activity
 * Returns recent activity timeline for the current user
 */
exports.myActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const activities = [];

    // Recent logins from user_activity_log (if table exists)
    try {
      const [logs] = await db.query(
        `SELECT action, description, metadata, ip_address, created_at
         FROM user_activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );
      logs.forEach(l => activities.push({
        type: l.action,
        description: l.description,
        metadata: l.metadata,
        ip_address: l.ip_address,
        timestamp: l.created_at,
      }));
    } catch (e) { /* table may not exist yet */ }

    // Recent task completions
    const [taskLogs] = await db.query(
      `SELECT t.title, tal.action, tal.created_at
       FROM task_activity_log tal
       JOIN tasks t ON t.id = tal.task_id
       WHERE tal.user_id = ? AND tal.action IN ('status_change','created')
       ORDER BY tal.created_at DESC LIMIT 10`,
      [userId]
    );
    taskLogs.forEach(l => activities.push({
      type: 'task',
      description: `${l.action === 'created' ? 'Created task' : 'Updated task'}: ${l.title}`,
      timestamp: l.created_at,
    }));

    // Recent leave actions
    const [leaveLogs] = await db.query(
      `SELECT leave_type, status, from_date, to_date, created_at, updated_at
       FROM leaves WHERE user_id = ? AND deleted = 0
       ORDER BY updated_at DESC LIMIT 5`,
      [userId]
    );
    leaveLogs.forEach(l => activities.push({
      type: 'leave',
      description: `${l.leave_type} leave ${l.status}`,
      timestamp: l.updated_at || l.created_at,
    }));

    // Recent attendance
    const [attendanceLogs] = await db.query(
      `SELECT date, clock_in, clock_out, clock_in_status
       FROM attendance WHERE user_id = ?
       ORDER BY date DESC LIMIT 5`,
      [userId]
    );
    attendanceLogs.forEach(a => activities.push({
      type: 'attendance',
      description: `Clocked in (${a.clock_in_status})${a.clock_out ? ' and clocked out' : ''}`,
      timestamp: a.clock_in,
    }));

    // Sort all by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json(activities.slice(0, 30));
  } catch (err) {
    console.error('myActivity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/sessions
 * Returns active sessions for the current user
 */
exports.mySessions = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, device, browser, ip_address, last_active, created_at, is_current
       FROM user_sessions WHERE user_id = ?
       ORDER BY last_active DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('mySessions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/users/me/sessions/:id
 * Revoke a specific session
 */
exports.revokeSession = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT id, is_current FROM user_sessions WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Session not found' });
    if (rows[0].is_current) return res.status(400).json({ message: 'Cannot revoke current session' });

    await db.query('DELETE FROM user_sessions WHERE id = ?', [id]);
    return res.json({ message: 'Session revoked' });
  } catch (err) {
    console.error('revokeSession error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/emergency-contacts
 */
exports.getEmergencyContacts = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM emergency_contacts WHERE user_id = ? ORDER BY created_at',
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getEmergencyContacts error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/users/me/emergency-contacts
 */
exports.addEmergencyContact = async (req, res) => {
  try {
    const { name, relationship, phone, email } = req.body;
    if (!name || !relationship || !phone) {
      return res.status(400).json({ message: 'Name, relationship, and phone are required' });
    }
    const [result] = await db.query(
      'INSERT INTO emergency_contacts (user_id, name, relationship, phone, email) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name, relationship, phone, email || null]
    );
    return res.status(201).json({ message: 'Contact added', id: result.insertId });
  } catch (err) {
    console.error('addEmergencyContact error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/users/me/emergency-contacts/:id
 */
exports.updateEmergencyContact = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, relationship, phone, email } = req.body;
    const [rows] = await db.query(
      'SELECT id FROM emergency_contacts WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contact not found' });

    await db.query(
      'UPDATE emergency_contacts SET name = ?, relationship = ?, phone = ?, email = ? WHERE id = ?',
      [name, relationship, phone, email || null, id]
    );
    return res.json({ message: 'Contact updated' });
  } catch (err) {
    console.error('updateEmergencyContact error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/users/me/emergency-contacts/:id
 */
exports.deleteEmergencyContact = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT id FROM emergency_contacts WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Contact not found' });

    await db.query('DELETE FROM emergency_contacts WHERE id = ?', [id]);
    return res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('deleteEmergencyContact error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/skills
 */
exports.getSkills = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, skill FROM user_skills WHERE user_id = ? ORDER BY skill',
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getSkills error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/users/me/skills
 */
exports.addSkill = async (req, res) => {
  try {
    const { skill } = req.body;
    if (!skill || !skill.trim()) {
      return res.status(400).json({ message: 'Skill is required' });
    }
    const [result] = await db.query(
      'INSERT IGNORE INTO user_skills (user_id, skill) VALUES (?, ?)',
      [req.user.id, skill.trim()]
    );
    if (result.affectedRows === 0) {
      return res.status(409).json({ message: 'Skill already exists' });
    }
    return res.status(201).json({ message: 'Skill added', id: result.insertId });
  } catch (err) {
    console.error('addSkill error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/users/me/skills/:id
 */
exports.deleteSkill = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT id FROM user_skills WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Skill not found' });

    await db.query('DELETE FROM user_skills WHERE id = ?', [id]);
    return res.json({ message: 'Skill deleted' });
  } catch (err) {
    console.error('deleteSkill error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/timesheet
 * Returns attendance + time tracking data for the current week
 */
exports.myTimesheet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start_date, end_date } = req.query;

    // Default to current week (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startStr = start_date || monday.toISOString().split('T')[0];
    const endStr = end_date || sunday.toISOString().split('T')[0];

    // Attendance records
    const [attendance] = await db.query(
      `SELECT date, clock_in, clock_out, clock_in_status, total_served_seconds, total_afs_seconds
       FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [userId, startStr, endStr]
    );

    // Task time logs
    const [taskTime] = await db.query(
      `SELECT DATE(started_at) AS log_date, SUM(duration) AS total_seconds
       FROM task_time_logs WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
       AND ended_at IS NOT NULL AND duration > 0
       GROUP BY DATE(started_at)`,
      [userId, startStr, endStr]
    );

    // Ticket time logs
    const [ticketTime] = await db.query(
      `SELECT log_date, SUM(minutes) AS total_minutes
       FROM ticket_time_logs WHERE user_id = ? AND log_date BETWEEN ? AND ?
       GROUP BY log_date`,
      [userId, startStr, endStr]
    );

    // Meeting time — use actual timer logs, not scheduled meeting times
    const [meetingTime] = await db.query(
      `SELECT DATE(ml.started_at) AS log_date, SUM(ml.duration) AS total_seconds
       FROM meeting_time_logs ml
       WHERE ml.user_id = ? AND DATE(ml.started_at) BETWEEN ? AND ?
       AND ml.ended_at IS NOT NULL AND ml.duration > 0
       GROUP BY DATE(ml.started_at)`,
      [userId, startStr, endStr]
    );

    // Summary
    const totalServed = attendance.reduce((sum, a) => sum + (Number(a.total_served_seconds) || 0), 0);
    const totalAfs = attendance.reduce((sum, a) => sum + (Number(a.total_afs_seconds) || 0), 0);
    const totalTaskSeconds = taskTime.reduce((sum, t) => sum + (Number(t.total_seconds) || 0), 0);
    const totalTicketMinutes = ticketTime.reduce((sum, t) => sum + (Number(t.total_minutes) || 0), 0);
    const totalMeetingSeconds = meetingTime.reduce((sum, m) => sum + (Number(m.total_seconds) || 0), 0);

    const rawProductiveSeconds = totalTaskSeconds + (totalTicketMinutes * 60) + totalMeetingSeconds;
    // Cap productive to never exceed served (handles overlapping timers)
    const productiveSeconds = Math.min(rawProductiveSeconds, totalServed);
    // Deduct lunch per day present from unaccounted time
    const [settings] = await db.query('SELECT lunch_duration_minutes FROM attendance_settings WHERE id = 1');
    const lunchSeconds = (settings[0]?.lunch_duration_minutes || 60) * 60;
    const unaccountedSeconds = Math.max(0, totalServed - productiveSeconds - totalAfs);
    const totalLunchDeduction = Math.min(lunchSeconds * attendance.length, unaccountedSeconds);
    const idleSeconds = Math.max(0, unaccountedSeconds - totalLunchDeduction);

    return res.json({
      period: { start: startStr, end: endStr },
      attendance,
      taskTime,
      ticketTime,
      meetingTime,
      summary: {
        total_served_seconds: totalServed,
        total_afs_seconds: totalAfs,
        productive_seconds: productiveSeconds,
        idle_seconds: idleSeconds,
        total_task_seconds: totalTaskSeconds,
        total_ticket_minutes: totalTicketMinutes,
        total_meeting_seconds: totalMeetingSeconds,
        days_present: attendance.length,
      },
    });
  } catch (err) {
    console.error('myTimesheet error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/timesheet/day?date=YYYY-MM-DD
 * Returns detailed breakdown of a specific day: task logs, ticket logs, meeting logs, AFS logs
 */
exports.myTimesheetDay = async (req, res) => {
  try {
    const userId = req.user.id;
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Valid date (YYYY-MM-DD) is required' });
    }

    // Task time logs with task title
    const [taskLogs] = await db.query(
      `SELECT tl.id, tl.task_id, t.title AS task_title, tl.started_at, tl.ended_at, tl.duration, tl.note
       FROM task_time_logs tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE tl.user_id = ? AND DATE(tl.started_at) = ?
       ORDER BY tl.started_at ASC`,
      [userId, date]
    );

    // Ticket time logs with ticket title
    const [ticketLogs] = await db.query(
      `SELECT tl.id, tl.ticket_id, tk.title AS ticket_title, tl.started_at, tl.ended_at, tl.duration, tl.description AS note
       FROM ticket_time_logs tl
       JOIN tickets tk ON tk.id = tl.ticket_id
       WHERE tl.user_id = ? AND DATE(tl.started_at) = ?
       ORDER BY tl.started_at ASC`,
      [userId, date]
    );

    // Meeting time logs with meeting title
    const [meetingLogs] = await db.query(
      `SELECT ml.id, ml.meeting_id, m.title AS meeting_title, ml.started_at, ml.ended_at, ml.duration, ml.note
       FROM meeting_time_logs ml
       JOIN meetings m ON m.id = ml.meeting_id
       WHERE ml.user_id = ? AND DATE(ml.started_at) = ?
       ORDER BY ml.started_at ASC`,
      [userId, date]
    );

    // AFS logs
    const [afsLogs] = await db.query(
      `SELECT id, start_time, end_time, duration_seconds
       FROM afs_logs
       WHERE user_id = ? AND DATE(start_time) = ?
       ORDER BY start_time ASC`,
      [userId, date]
    );

    // Attendance for that day
    const [attendance] = await db.query(
      `SELECT clock_in, clock_out, clock_in_status, total_served_seconds, total_afs_seconds
       FROM attendance WHERE user_id = ? AND date = ?`,
      [userId, date]
    );

    const totalTaskSeconds = taskLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const totalTicketSeconds = ticketLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const totalMeetingSeconds = meetingLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const totalAfsSeconds = afsLogs.reduce((sum, l) => sum + (Number(l.duration_seconds) || 0), 0);
    const rawProductiveSeconds = totalTaskSeconds + totalTicketSeconds + totalMeetingSeconds;
    const totalServedSeconds = Number(attendance[0]?.total_served_seconds) || 0;
    // Cap productive to never exceed served (handles overlapping timers)
    const productiveSeconds = Math.min(rawProductiveSeconds, totalServedSeconds);
    // Deduct lunch from unaccounted time
    const [settings] = await db.query('SELECT lunch_duration_minutes FROM attendance_settings WHERE id = 1');
    const lunchSeconds = (settings[0]?.lunch_duration_minutes || 60) * 60;
    const unaccountedSeconds = Math.max(0, totalServedSeconds - productiveSeconds - totalAfsSeconds);
    const lunchDeduction = Math.min(lunchSeconds, unaccountedSeconds);
    const idleSeconds = Math.max(0, unaccountedSeconds - lunchDeduction);

    return res.json({
      date,
      attendance: attendance[0] || null,
      tasks: taskLogs,
      tickets: ticketLogs,
      meetings: meetingLogs,
      afs: afsLogs,
      summary: {
        total_task_seconds: totalTaskSeconds,
        total_ticket_seconds: totalTicketSeconds,
        total_meeting_seconds: totalMeetingSeconds,
        total_afs_seconds: totalAfsSeconds,
        productive_seconds: productiveSeconds,
        idle_seconds: idleSeconds,
      },
    });
  } catch (err) {
    console.error('myTimesheetDay error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/tickets
 * Returns tickets assigned to or reported by the user
 */
exports.myTickets = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, status, priority, ticket_type, due_date, created_at
       FROM tickets
       WHERE (assigned_to = ? OR reported_by = ?) AND deleted = 0
       ORDER BY FIELD(status, 'open', 'in_progress', 'hold', 'resolved', 'closed'), created_at DESC
       LIMIT 50`,
      [req.user.id, req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('myTickets error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/users/me/meetings
 * Returns meetings the user is part of
 */
exports.myMeetings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.id, m.title, m.meeting_date, m.start_time, m.end_time, m.status, m.meeting_type
       FROM meetings m
       LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
       WHERE (m.created_by = ? OR mm.user_id = ?) AND m.deleted = 0
       GROUP BY m.id
       ORDER BY m.meeting_date DESC, m.start_time DESC
       LIMIT 50`,
      [req.user.id, req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('myMeetings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
