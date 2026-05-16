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

module.exports = { authenticate, requireAdmin };
