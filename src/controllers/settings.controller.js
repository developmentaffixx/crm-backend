const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const db = require('../config/db');
const { sendTemplateEmail } = require('../services/email.service');

// ─── Audit Log Helper ─────────────────────────────────────────────────────────
async function logAudit(db, userId, action, entityType, entityId, details, ip) {
  try {
    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        userId,
        action,
        entityType || null,
        entityId   || null,
        details    ? JSON.stringify(details) : null,
        ip         || null,
      ]
    );
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

// ─── ROLES ────────────────────────────────────────────────────────────────────

/**
 * GET /api/settings/roles
 * Returns all roles with user count.
 */
exports.getRoles = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, COUNT(u.id) AS user_count
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id AND u.deleted = 0
       GROUP BY r.id
       ORDER BY r.id`
    );
    return res.json(rows);
  } catch (err) {
    console.error('getRoles error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/settings/roles
 * Create a new role and seed empty permissions for all modules.
 */
exports.createRole = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description = '' } = req.body;

  try {
    // Check duplicate name
    const [existing] = await db.query('SELECT id FROM roles WHERE name = ?', [name]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'A role with that name already exists' });
    }

    const [result] = await db.query(
      'INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)',
      [name, description]
    );
    const roleId = result.insertId;

    // Seed empty permissions for all 12 modules
    const modules = ['dashboard','projects','tasks','tickets','meetings','creative_hub','people_ops','clients','revenue','finance','playbook','reports','settings'];
    const permValues = modules.map(m => [roleId, m, 0, 0, 0, 0]);
    await db.query(
      'INSERT IGNORE INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) VALUES ?',
      [permValues]
    );

    await logAudit(db, req.user.id, 'role_created', 'role', roleId, { name }, req.ip);

    return res.status(201).json({ message: 'Role created', id: roleId });
  } catch (err) {
    console.error('createRole error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/roles/:id
 * Update role name/description. Blocks renaming system roles.
 */
exports.updateRole = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const roleId = parseInt(req.params.id, 10);
  const { name, description, responsibilities } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Role not found' });

    const role = rows[0];
    if (role.is_system && name && name !== role.name) {
      return res.status(403).json({ message: 'Cannot rename a system role' });
    }

    // Check duplicate name (excluding self)
    if (name) {
      const [dup] = await db.query('SELECT id FROM roles WHERE name = ? AND id != ?', [name, roleId]);
      if (dup.length > 0) return res.status(409).json({ message: 'A role with that name already exists' });
    }

    const newName             = name             !== undefined ? name             : role.name;
    const newDescription      = description      !== undefined ? description      : role.description;
    const newResponsibilities = responsibilities !== undefined ? responsibilities : (role.responsibilities || null);

    await db.query('UPDATE roles SET name = ?, description = ?, responsibilities = ? WHERE id = ?', [newName, newDescription, newResponsibilities, roleId]);
    await logAudit(db, req.user.id, 'role_updated', 'role', roleId, { name: newName }, req.ip);

    return res.json({ message: 'Role updated' });
  } catch (err) {
    console.error('updateRole error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/settings/roles/:id
 * Delete role. Blocks if users assigned or is_system.
 */
exports.deleteRole = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const roleId = parseInt(req.params.id, 10);

  try {
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Role not found' });

    const role = rows[0];
    if (role.is_system) {
      return res.status(403).json({ message: 'Cannot delete a system role' });
    }

    const [users] = await db.query(
      'SELECT COUNT(*) AS cnt FROM users WHERE role_id = ? AND deleted = 0',
      [roleId]
    );
    if (users[0].cnt > 0) {
      return res.status(400).json({ message: `Cannot delete role: ${users[0].cnt} user(s) are assigned to it` });
    }

    await db.query('DELETE FROM roles WHERE id = ?', [roleId]);
    await logAudit(db, req.user.id, 'role_deleted', 'role', roleId, { name: role.name }, req.ip);

    return res.json({ message: 'Role deleted' });
  } catch (err) {
    console.error('deleteRole error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PERMISSIONS ──────────────────────────────────────────────────────────────

/**
 * GET /api/settings/roles/:id/permissions
 */
exports.getRolePermissions = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const roleId = parseInt(req.params.id, 10);

  try {
    const [rows] = await db.query('SELECT * FROM role_permissions WHERE role_id = ?', [roleId]);
    return res.json(rows);
  } catch (err) {
    console.error('getRolePermissions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/settings/roles/:id/members
 * Returns users assigned to this role
 */
exports.getRoleMembers = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const roleId = parseInt(req.params.id, 10);

  try {
    const [rows] = await db.query(
      `SELECT id, first_name, last_name, email, avatar_url, designation, department
       FROM users WHERE role_id = ? AND deleted = 0 AND is_active = 1
       ORDER BY first_name, last_name`,
      [roleId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getRoleMembers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/roles/:id/permissions
 * Upsert permissions for a role.
 * Body: { permissions: [{ module, can_view, can_create, can_edit, can_delete }] }
 */
exports.updateRolePermissions = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const roleId = parseInt(req.params.id, 10);
  const { permissions } = req.body;

  if (!Array.isArray(permissions) || permissions.length === 0) {
    return res.status(400).json({ message: 'permissions array is required' });
  }

  try {
    const [roleRows] = await db.query('SELECT id, is_system FROM roles WHERE id = ?', [roleId]);
    if (roleRows.length === 0) return res.status(404).json({ message: 'Role not found' });

    // Block modifying system role permissions on the backend — REMOVED
    // System roles can now be fully customized

    for (const perm of permissions) {
      const { module, can_view = 0, can_create = 0, can_edit = 0, can_delete = 0 } = perm;
      await db.query(
        `INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           can_view   = VALUES(can_view),
           can_create = VALUES(can_create),
           can_edit   = VALUES(can_edit),
           can_delete = VALUES(can_delete)`,
        [roleId, module, can_view, can_create, can_edit, can_delete]
      );
    }

    await logAudit(db, req.user.id, 'permissions_updated', 'role', roleId, { permissions }, req.ip);

    return res.json({ message: 'Permissions updated' });
  } catch (err) {
    console.error('updateRolePermissions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── USER MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * GET /api/settings/users
 * All users with role name + reporting manager name joined.
 */
exports.getUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.emp_code, u.first_name, u.last_name, u.email, u.phone, u.avatar_url,
              u.department, u.designation, u.date_of_joining, u.reporting_to,
              u.is_admin, u.is_active, u.role_id, u.created_at, u.last_login_at,
              u.invite_token, u.invite_sent_at,
              r.name AS role_name,
              CONCAT(mgr.first_name, ' ', mgr.last_name) AS reporting_to_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN users mgr ON mgr.id = u.reporting_to AND mgr.deleted = 0
       WHERE u.deleted = 0
       ORDER BY u.created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('getUsers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/settings/users/next-emp-code
 * Returns the next suggested AFID### code (skips any already in use).
 */
exports.getNextEmpCode = async (req, res) => {
  try {
    // Get all existing AFID#### codes
    const [rows] = await db.query(
      `SELECT emp_code FROM users WHERE emp_code LIKE 'AFID%' AND deleted = 0`
    );
    const usedNumbers = rows
      .map(r => parseInt(r.emp_code.replace('AFID', ''), 10))
      .filter(n => !isNaN(n));

    // Find the next available number
    let next = 1;
    while (usedNumbers.includes(next)) next++;

    return res.json({ emp_code: `AFID${String(next).padStart(4, '0')}` });
  } catch (err) {
    console.error('getNextEmpCode error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/settings/users
 * Create a new user.
 */
exports.createUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    first_name, last_name, email, password, role_id = null,
    phone = '', department = '', designation = '', date_of_joining = null, reporting_to = null,
  } = req.body;

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Auto-set is_admin based on whether the assigned role is the system Admin role
    let resolvedIsAdmin = 0;
    if (role_id) {
      const [roleRows] = await db.query('SELECT is_system, name FROM roles WHERE id = ?', [role_id]);
      if (roleRows.length > 0 && roleRows[0].is_system === 1 && roleRows[0].name === 'Admin') {
        resolvedIsAdmin = 1;
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, department, designation, date_of_joining, reporting_to, password_hash, is_admin, role_id, is_active, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [first_name, last_name, email, phone, department, designation, date_of_joining || null, reporting_to || null, hash, resolvedIsAdmin, role_id || null]
    );

    const newUserId = result.insertId;

    // Auto-generate emp_code: DOUBT for admin, AFID#### for employees
    let emp_code;
    if (resolvedIsAdmin) {
      emp_code = 'DOUBT';
    } else {
      // Find next available AFID number
      const [codeRows] = await db.query(
        `SELECT emp_code FROM users WHERE emp_code LIKE 'AFID%' AND deleted = 0`
      );
      const usedNumbers = codeRows
        .map(r => parseInt(r.emp_code.replace('AFID', ''), 10))
        .filter(n => !isNaN(n));
      let next = 1;
      while (usedNumbers.includes(next)) next++;
      emp_code = `AFID${String(next).padStart(4, '0')}`;
    }
    await db.query('UPDATE users SET emp_code = ? WHERE id = ?', [emp_code, newUserId]);

    // Fix #7: Log initial role assignment in role history if a role was given
    if (role_id) {
      await db.query(
        `INSERT INTO user_role_history (user_id, from_role_id, to_role_id, changed_by, reason)
         VALUES (?, NULL, ?, ?, 'Initial role assignment on user creation')`,
        [newUserId, role_id, req.user.id]
      );
    }

    await logAudit(db, req.user.id, 'user_created', 'user', newUserId, { email, first_name, last_name }, req.ip);

    // Send welcome email (fire-and-forget — don't fail the request if email fails)
    const [cfgRows] = await db.query('SELECT from_email, enabled FROM email_settings WHERE id = 1');
    const emailEnabled = cfgRows[0]?.enabled;
    if (emailEnabled && req.body.send_welcome_email !== false) {
      const loginUrl = process.env.APP_URL || 'http://localhost:5173';
      const [companyRows] = await db.query('SELECT from_name FROM email_settings WHERE id = 1');
      const companyName = companyRows[0]?.from_name || 'CRM System';
      sendTemplateEmail('welcome_user', email, {
        first_name,
        last_name,
        email,
        password,
        login_url:    loginUrl,
        company_name: companyName,
      }).catch(e => console.error('Welcome email failed:', e.message));
    }

    return res.status(201).json({ message: 'User created', id: newUserId });
  } catch (err) {
    console.error('createUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/users/:id
 * Update user fields. Logs role change if role_id changes.
 */
exports.updateUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userId = parseInt(req.params.id, 10);
  const { first_name, last_name, email, role_id, is_active, reason,
          phone, department, designation, date_of_joining, reporting_to } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ? AND deleted = 0', [userId]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = rows[0];

    // Check email uniqueness if changing
    if (email && email !== user.email) {
      const [dup] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
      if (dup.length > 0) return res.status(409).json({ message: 'Email already in use' });
    }

    const newFirstName     = first_name     !== undefined ? first_name     : user.first_name;
    const newLastName      = last_name      !== undefined ? last_name      : user.last_name;
    const newEmail         = email          !== undefined ? email          : user.email;
    const newRoleId        = role_id        !== undefined ? (role_id || null) : user.role_id;
    const newIsActive      = is_active      !== undefined ? (is_active ? 1 : 0) : user.is_active;

    // Auto-sync is_admin: set to 1 only when assigned the system Admin role, else 0
    let newIsAdmin = user.is_admin;
    if (role_id !== undefined) {
      if (newRoleId) {
        const [roleRows] = await db.query('SELECT is_system, name FROM roles WHERE id = ?', [newRoleId]);
        newIsAdmin = (roleRows.length > 0 && roleRows[0].is_system === 1 && roleRows[0].name === 'Admin') ? 1 : 0;
      } else {
        // Role removed — revoke admin
        newIsAdmin = 0;
      }
    }
    const newPhone         = phone          !== undefined ? phone          : (user.phone || '');
    const newDepartment    = department     !== undefined ? department     : (user.department || '');
    const newDesignation   = designation    !== undefined ? designation    : (user.designation || '');
    const newDateOfJoining = date_of_joining !== undefined ? (date_of_joining || null) : user.date_of_joining;
    const newReportingTo   = reporting_to   !== undefined ? (reporting_to || null) : user.reporting_to;
    // emp_code is auto-generated and not editable — keep existing value
    const newEmpCode       = user.emp_code;

    await db.query(
      `UPDATE users SET first_name = ?, last_name = ?, email = ?, role_id = ?, is_active = ?, is_admin = ?,
       phone = ?, department = ?, designation = ?, date_of_joining = ?, reporting_to = ?, emp_code = ?
       WHERE id = ?`,
      [newFirstName, newLastName, newEmail, newRoleId, newIsActive, newIsAdmin,
       newPhone, newDepartment, newDesignation, newDateOfJoining, newReportingTo, newEmpCode, userId]
    );

    // Log role change if role_id changed
    if (role_id !== undefined && newRoleId !== user.role_id) {
      await db.query(
        `INSERT INTO user_role_history (user_id, from_role_id, to_role_id, changed_by, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, user.role_id || null, newRoleId, req.user.id, reason || null]
      );
      await logAudit(db, req.user.id, 'role_changed', 'user', userId, {
        from_role_id: user.role_id,
        to_role_id:   newRoleId,
      }, req.ip);

      // Send role changed email (fire-and-forget)
      const [cfgRows] = await db.query('SELECT enabled, from_name FROM email_settings WHERE id = 1');
      if (cfgRows[0]?.enabled) {
        const [fromRole] = user.role_id
          ? await db.query('SELECT name FROM roles WHERE id = ?', [user.role_id])
          : [[]];
        const [toRole] = newRoleId
          ? await db.query('SELECT name FROM roles WHERE id = ?', [newRoleId])
          : [[]];
        const loginUrl    = process.env.APP_URL || 'http://localhost:5173';
        const companyName = cfgRows[0]?.from_name || 'CRM System';
        sendTemplateEmail('role_changed', user.email, {
          first_name:   user.first_name,
          from_role:    fromRole[0]?.name || 'No Role',
          to_role:      toRole[0]?.name   || 'No Role',
          login_url:    loginUrl,
          company_name: companyName,
        }).catch(e => console.error('Role changed email failed:', e.message));
      }
    }

    await logAudit(db, req.user.id, 'user_updated', 'user', userId, {
      first_name: newFirstName,
      last_name:  newLastName,
      email:      newEmail,
      is_admin:   newIsAdmin,
      emp_code:   newEmpCode,
    }, req.ip);

    return res.json({ message: 'User updated' });
  } catch (err) {
    console.error('updateUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/users/:id/deactivate
 * Set is_active = 0. Cannot deactivate self.
 */
exports.deactivateUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userId = parseInt(req.params.id, 10);

  if (userId === req.user.id) {
    return res.status(400).json({ message: 'You cannot deactivate your own account' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ? AND deleted = 0', [userId]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = rows[0];
    const newStatus = user.is_active === 1 ? 0 : 1;

    await db.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);
    await logAudit(db, req.user.id, newStatus ? 'user_activated' : 'user_deactivated', 'user', userId, {}, req.ip);

    return res.json({ message: newStatus ? 'User activated' : 'User deactivated' });
  } catch (err) {
    console.error('deactivateUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/users/:id/reset-password
 * Reset user password.
 */
exports.resetPassword = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userId = parseInt(req.params.id, 10);
  const { password } = req.body;

  try {
    const [rows] = await db.query('SELECT id FROM users WHERE id = ? AND deleted = 0', [userId]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?', [hash, userId]);
    await logAudit(db, req.user.id, 'password_reset', 'user', userId, {}, req.ip);

    // Send password reset email (fire-and-forget)
    const [userRows] = await db.query('SELECT first_name, email FROM users WHERE id = ?', [userId]);
    if (userRows.length) {
      const [cfgRows] = await db.query('SELECT enabled, from_name FROM email_settings WHERE id = 1');
      if (cfgRows[0]?.enabled) {
        const loginUrl    = process.env.APP_URL || 'http://localhost:5173';
        const companyName = cfgRows[0]?.from_name || 'CRM System';
        sendTemplateEmail('password_reset', userRows[0].email, {
          first_name:   userRows[0].first_name,
          new_password: password,
          login_url:    loginUrl,
          company_name: companyName,
        }).catch(e => console.error('Password reset email failed:', e.message));
      }
    }

    return res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/settings/users/:id/role-history
 * Role change history for a user.
 */
exports.getUserRoleHistory = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const userId = parseInt(req.params.id, 10);

  try {
    const [rows] = await db.query(
      `SELECT urh.*,
              r1.name AS from_role_name,
              r2.name AS to_role_name,
              CONCAT(u.first_name, ' ', u.last_name) AS changed_by_name
       FROM user_role_history urh
       LEFT JOIN roles r1 ON r1.id = urh.from_role_id
       LEFT JOIN roles r2 ON r2.id = urh.to_role_id
       LEFT JOIN users u  ON u.id  = urh.changed_by
       WHERE urh.user_id = ?
       ORDER BY urh.changed_at DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getUserRoleHistory error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/settings/users/:id
 * Full user detail with role history, reporting manager, etc.
 */
exports.getUserDetail = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    const [rows] = await db.query(
      `SELECT u.*, r.name AS role_name,
              CONCAT(mgr.first_name, ' ', mgr.last_name) AS reporting_to_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN users mgr ON mgr.id = u.reporting_to AND mgr.deleted = 0
       WHERE u.id = ? AND u.deleted = 0`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ message: 'User not found' });

    const user = rows[0];
    delete user.password_hash; // never expose

    // Get role history
    const [history] = await db.query(
      `SELECT urh.*, r1.name AS from_role_name, r2.name AS to_role_name,
              CONCAT(cb.first_name, ' ', cb.last_name) AS changed_by_name
       FROM user_role_history urh
       LEFT JOIN roles r1 ON r1.id = urh.from_role_id
       LEFT JOIN roles r2 ON r2.id = urh.to_role_id
       LEFT JOIN users cb ON cb.id = urh.changed_by
       WHERE urh.user_id = ? ORDER BY urh.changed_at DESC LIMIT 10`,
      [userId]
    );

    return res.json({ ...user, role_history: history });
  } catch (err) {
    console.error('getUserDetail error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/settings/users/:id/upload-avatar
 * Upload user profile photo.
 */
exports.uploadAvatar = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

    // Delete old avatar from Cloudinary
    const [current] = await db.query('SELECT avatar_url FROM users WHERE id = ?', [userId]);
    if (current[0]?.avatar_url) {
      const oldPublicId = extractPublicId(current[0].avatar_url);
      if (oldPublicId) await deleteFromCloudinary(oldPublicId, 'image');
    }

    const { url } = await uploadToCloudinary(req.file.buffer, 'crm/avatars', 'image');
    await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [url, userId]);

    return res.json({ message: 'Avatar uploaded', url });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── TASK SETTINGS ────────────────────────────────────────────────────────────

/**
 * GET /api/settings/task-settings
 */
exports.getTaskSettings = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM task_settings WHERE id = 1');
    if (rows.length === 0) return res.status(404).json({ message: 'Task settings not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('getTaskSettings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/task-settings
 */
exports.updateTaskSettings = async (req, res) => {
  const {
    members_can_create_tasks,
    require_approval_new_tasks,
    require_approval_completion,
    default_priority,
    max_deadline_extension_days,
  } = req.body;

  const validPriorities = ['low', 'medium', 'high'];
  if (default_priority && !validPriorities.includes(default_priority)) {
    return res.status(400).json({ message: 'Invalid default_priority value' });
  }

  if (max_deadline_extension_days !== undefined) {
    const days = parseInt(max_deadline_extension_days, 10);
    if (isNaN(days) || days < 0) {
      return res.status(400).json({ message: 'max_deadline_extension_days must be a non-negative integer' });
    }
  }

  try {
    const [existing] = await db.query('SELECT * FROM task_settings WHERE id = 1');
    const current = existing[0] || {};

    const newSettings = {
      members_can_create_tasks:    members_can_create_tasks    !== undefined ? (members_can_create_tasks    ? 1 : 0) : current.members_can_create_tasks,
      require_approval_new_tasks:  require_approval_new_tasks  !== undefined ? (require_approval_new_tasks  ? 1 : 0) : current.require_approval_new_tasks,
      require_approval_completion: require_approval_completion !== undefined ? (require_approval_completion ? 1 : 0) : current.require_approval_completion,
      default_priority:            default_priority            !== undefined ? default_priority            : current.default_priority,
      max_deadline_extension_days: max_deadline_extension_days !== undefined ? parseInt(max_deadline_extension_days, 10) : current.max_deadline_extension_days,
    };

    await db.query(
      `UPDATE task_settings
       SET members_can_create_tasks    = ?,
           require_approval_new_tasks  = ?,
           require_approval_completion = ?,
           default_priority            = ?,
           max_deadline_extension_days = ?
       WHERE id = 1`,
      [
        newSettings.members_can_create_tasks,
        newSettings.require_approval_new_tasks,
        newSettings.require_approval_completion,
        newSettings.default_priority,
        newSettings.max_deadline_extension_days,
      ]
    );

    await logAudit(db, req.user.id, 'task_settings_updated', 'task_settings', 1, newSettings, req.ip);

    return res.json({ message: 'Task settings updated', settings: newSettings });
  } catch (err) {
    console.error('updateTaskSettings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DAILY TARGETS SETTINGS ───────────────────────────────────────────────────

/**
 * GET /api/settings/daily-targets
 * Returns the configurable daily targets for the Daily Reporting tab.
 */
exports.getDailyTargets = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM daily_targets_settings WHERE id = 1');
    if (rows.length === 0) return res.status(404).json({ message: 'Daily targets settings not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('getDailyTargets error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/settings/daily-targets
 * Update daily targets settings (admin only).
 */
exports.updateDailyTargets = async (req, res) => {
  const {
    leads_sourced_min, leads_sourced_max,
    total_outreach_min, total_outreach_max,
    follow_ups_min, follow_ups_max,
    calls_min, calls_max,
    meetings_booked_min, meetings_booked_max,
  } = req.body;

  try {
    const [existing] = await db.query('SELECT * FROM daily_targets_settings WHERE id = 1');
    const current = existing[0] || {};

    const newSettings = {
      leads_sourced_min:   leads_sourced_min   !== undefined ? parseInt(leads_sourced_min, 10)   : current.leads_sourced_min,
      leads_sourced_max:   leads_sourced_max   !== undefined ? parseInt(leads_sourced_max, 10)   : current.leads_sourced_max,
      total_outreach_min:  total_outreach_min  !== undefined ? parseInt(total_outreach_min, 10)  : current.total_outreach_min,
      total_outreach_max:  total_outreach_max  !== undefined ? parseInt(total_outreach_max, 10)  : current.total_outreach_max,
      follow_ups_min:      follow_ups_min      !== undefined ? parseInt(follow_ups_min, 10)      : current.follow_ups_min,
      follow_ups_max:      follow_ups_max      !== undefined ? parseInt(follow_ups_max, 10)      : current.follow_ups_max,
      calls_min:           calls_min           !== undefined ? parseInt(calls_min, 10)           : current.calls_min,
      calls_max:           calls_max           !== undefined ? parseInt(calls_max, 10)           : current.calls_max,
      meetings_booked_min: meetings_booked_min !== undefined ? parseInt(meetings_booked_min, 10) : current.meetings_booked_min,
      meetings_booked_max: meetings_booked_max !== undefined ? parseInt(meetings_booked_max, 10) : current.meetings_booked_max,
    };

    await db.query(
      `UPDATE daily_targets_settings
       SET leads_sourced_min   = ?, leads_sourced_max   = ?,
           total_outreach_min  = ?, total_outreach_max  = ?,
           follow_ups_min      = ?, follow_ups_max      = ?,
           calls_min           = ?, calls_max           = ?,
           meetings_booked_min = ?, meetings_booked_max = ?
       WHERE id = 1`,
      [
        newSettings.leads_sourced_min, newSettings.leads_sourced_max,
        newSettings.total_outreach_min, newSettings.total_outreach_max,
        newSettings.follow_ups_min, newSettings.follow_ups_max,
        newSettings.calls_min, newSettings.calls_max,
        newSettings.meetings_booked_min, newSettings.meetings_booked_max,
      ]
    );

    await logAudit(db, req.user.id, 'daily_targets_updated', 'daily_targets_settings', 1, newSettings, req.ip);

    return res.json({ message: 'Daily targets updated', settings: newSettings });
  } catch (err) {
    console.error('updateDailyTargets error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

/**
 * GET /api/settings/audit-logs
 * Paginated audit log with optional filters.
 */
exports.getAuditLogs = async (req, res) => {
  try {
    const {
      user_id,
      action,
      entity_type,
      date_from,
      date_to,
      page  = 1,
      limit = 50,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [];
    const params     = [];

    if (user_id) {
      conditions.push('al.user_id = ?');
      params.push(parseInt(user_id, 10));
    }
    if (action) {
      conditions.push('al.action LIKE ?');
      params.push(`%${action}%`);
    }
    if (entity_type) {
      conditions.push('al.entity_type = ?');
      params.push(entity_type);
    }
    if (date_from) {
      conditions.push('al.created_at >= ?');
      params.push(date_from);
    }
    if (date_to) {
      conditions.push('al.created_at <= ?');
      params.push(date_to + ' 23:59:59');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) AS total FROM audit_logs al ${whereClause}`;
    const [countRows] = await db.query(countQuery, params);
    const total = countRows[0].total;

    const dataQuery = `
      SELECT al.*,
             CONCAT(u.first_name, ' ', u.last_name) AS user_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [logs] = await db.query(dataQuery, [...params, limitNum, offset]);

    return res.json({
      logs,
      total,
      page:       pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
