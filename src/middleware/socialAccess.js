const db = require('../config/db');

/**
 * Middleware factory that checks if the user's role has access to a specific
 * Social Media Ops submenu. Admins bypass this check.
 *
 * @param {'social_overview'|'content_calendar'|'content_writing'|'shoot_planning'|'ads_planning'|'daily_journal'|'report_centre'} submenu
 */
function requireSocialAccess(submenu) {
  return async (req, res, next) => {
    try {
      // Admins bypass
      if (req.user.is_admin) return next();

      // Get user's role_id
      const [userRows] = await db.query(
        'SELECT role_id FROM users WHERE id = ? AND deleted = 0',
        [req.user.id]
      );

      if (!userRows.length || !userRows[0].role_id) {
        return res.status(403).json({ message: 'No role assigned. Access denied.' });
      }

      const roleId = userRows[0].role_id;

      // Check social submenu permission
      const [rows] = await db.query(
        `SELECT ${submenu} FROM role_social_permissions WHERE role_id = ?`,
        [roleId]
      );

      if (!rows.length || !rows[0][submenu]) {
        return res.status(403).json({ message: 'You do not have access to this section.' });
      }

      next();
    } catch (err) {
      console.error('requireSocialAccess error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

module.exports = { requireSocialAccess };
