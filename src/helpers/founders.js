const db = require('../config/db');

/**
 * Founder / CEO users: the "CEO" role, or anyone granted the CEO dashboard
 * (module 'dashboard', submenu 'dashboard_ceo'; a user override wins over the role).
 * Admin status alone does not make someone a Founder.
 */
async function listFounders() {
  const [rows] = await db.query(
    `SELECT u.id, u.first_name, u.last_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.deleted = 0 AND u.is_active = 1
        AND (
          LOWER(TRIM(r.name)) = 'ceo'
          OR COALESCE(
               (SELECT usp.can_access FROM user_submenu_permissions usp
                 WHERE usp.user_id = u.id AND usp.module = 'dashboard' AND usp.submenu = 'dashboard_ceo' LIMIT 1),
               (SELECT rsp.can_access FROM role_submenu_permissions rsp
                 WHERE rsp.role_id = u.role_id AND rsp.module = 'dashboard' AND rsp.submenu = 'dashboard_ceo' LIMIT 1),
               0) >= 1
        )
      ORDER BY u.first_name, u.last_name`
  );
  return rows;
}

module.exports = { listFounders };
