const db = require('../config/db');
const path = require('path');
const fs   = require('fs');

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

    const filename = `avatar-${req.user.id}-${Date.now()}${path.extname(req.file.originalname)}`;
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // Delete old avatar if exists
    const [current] = await db.query('SELECT avatar_url FROM users WHERE id = ?', [req.user.id]);
    if (current[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '../../', current[0].avatar_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const url = `/uploads/${filename}`;
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
    await db.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, req.user.id]);

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
      return res.json({ is_admin: true, role_id: null, role_name: 'Admin', permissions: perms });
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

    const [roleRows] = await db.query('SELECT name FROM roles WHERE id = ?', [roleId]);
    const roleName = roleRows[0]?.name || null;

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

    return res.json({ is_admin: false, role_id: roleId, role_name: roleName, permissions });
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
