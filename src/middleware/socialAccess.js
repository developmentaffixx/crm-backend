const db = require('../config/db');

/**
 * Middleware factory that checks if the user's role has access to a specific
 * Social Media Ops submenu. Admins bypass this check.
 * Values: 0 = None (blocked), 1 = Own (access to own items), 2 = All (full access)
 *
 * @param {'social_overview'|'content_calendar'|'content_writing'|'shoot_planning'|'ads_planning'|'daily_journal'|'report_centre'} submenu
 */
function requireSocialAccess(submenu) {
  return async (req, res, next) => {
    try {
      // Admins bypass
      if (req.user.is_admin) return next();

      // 1. Check user-level submenu override first
      try {
        const [userSubmenuRows] = await db.query(
          'SELECT can_access FROM user_submenu_permissions WHERE user_id = ? AND module = "creative_hub" AND submenu = ?',
          [req.user.id, submenu]
        );
        if (userSubmenuRows.length > 0) {
          const level = userSubmenuRows[0].can_access;
          if (level < 1) {
            return res.status(403).json({ message: 'You do not have access to this section.' });
          }
          req.socialAccessLevel = level;
          return next();
        }
      } catch (subErr) {
        // Table may not exist or error, continue
      }

      // 2. Check user-level module override (can_view on creative_hub)
      try {
        const [userPerms] = await db.query(
          'SELECT can_view FROM user_permissions WHERE user_id = ? AND module = "creative_hub"',
          [req.user.id]
        );
        if (userPerms.length > 0) {
          const level = userPerms[0].can_view;
          if (level < 1) {
            return res.status(403).json({ message: 'You do not have access to this section.' });
          }
          req.socialAccessLevel = level;
          return next();
        }
      } catch (permErr) {
        // Continue
      }

      // 3. Fall back to role permissions
      const [userRows] = await db.query(
        'SELECT role_id FROM users WHERE id = ? AND deleted = 0',
        [req.user.id]
      );

      if (!userRows.length || !userRows[0].role_id) {
        return res.status(403).json({ message: 'No role assigned. Access denied.' });
      }

      const roleId = userRows[0].role_id;

      // Check role_social_permissions
      try {
        const [rows] = await db.query(
          `SELECT ${submenu} AS access_level FROM role_social_permissions WHERE role_id = ?`,
          [roleId]
        );

        if (rows.length && rows[0].access_level >= 1) {
          req.socialAccessLevel = rows[0].access_level;
          return next();
        }
      } catch (rErr) {
        // Continue
      }

      // Check role_permissions for creative_hub
      try {
        const [rolePerms] = await db.query(
          'SELECT can_view FROM role_permissions WHERE role_id = ? AND module = "creative_hub"',
          [roleId]
        );
        if (rolePerms.length && rolePerms[0].can_view >= 1) {
          req.socialAccessLevel = rolePerms[0].can_view;
          return next();
        }
      } catch (rpErr) {
        // Continue
      }

      return res.status(403).json({ message: 'You do not have access to this section.' });
    } catch (err) {
      console.error('requireSocialAccess error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

module.exports = { requireSocialAccess };
