const jwt = require('jsonwebtoken');
const db  = require('../config/db');

/**
 * Verifies JWT and attaches decoded user to req.user.
 * Fix #6: Also checks is_active from DB so deactivated users are blocked
 * immediately without waiting for token expiry.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Live check: verify user still exists and is active in DB
    const [rows] = await db.query(
      'SELECT id, email, is_admin, is_active, deleted FROM users WHERE id = ?',
      [decoded.id]
    );

    if (rows.length === 0 || rows[0].deleted === 1) {
      return res.status(401).json({ message: 'Account not found' });
    }

    if (rows[0].is_active === 0) {
      return res.status(401).json({ message: 'Account has been deactivated' });
    }

    // Merge DB is_admin (source of truth) with decoded token data
    req.user = {
      ...decoded,
      is_admin: rows[0].is_admin === 1,
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/**
 * Allows only admin users through.
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

/**
 * Checks if user has task approval permission (admin or can_approve on tasks module).
 */
async function canApproveTasks(user) {
  if (!user) return false;
  if (user.is_admin) return true;

  try {
    // User-level override wins over role
    const [userPerms] = await db.query(
      'SELECT can_approve FROM user_permissions WHERE user_id = ? AND module = ?',
      [user.id, 'tasks']
    );
    if (userPerms.length > 0) {
      return !!userPerms[0].can_approve;
    }

    // Role-level baseline
    const [userRole] = await db.query('SELECT role_id FROM users WHERE id = ?', [user.id]);
    if (userRole.length > 0 && userRole[0].role_id) {
      const [rolePerms] = await db.query(
        'SELECT can_approve FROM role_permissions WHERE role_id = ? AND module = ?',
        [userRole[0].role_id, 'tasks']
      );
      if (rolePerms.length > 0) {
        return !!rolePerms[0].can_approve;
      }
    }
  } catch (err) {
    console.error('canApproveTasks check error:', err);
  }

  return false;
}

/**
 * Allows admins or users with tasks can_approve permission.
 */
async function requireAdminOrTaskApprove(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (req.user.is_admin) {
    return next();
  }
  try {
    const allowed = await canApproveTasks(req.user);
    if (!allowed) {
      return res.status(403).json({ message: 'Approvals access required' });
    }
    next();
  } catch (err) {
    console.error('requireAdminOrTaskApprove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { authenticate, requireAdmin, canApproveTasks, requireAdminOrTaskApprove };

