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
      if (req.user.is_admin) {
        req.socialAccessLevel = 2;
        req.userCanView     = true;
        req.userCanCreate   = true;
        req.userCanEdit     = true;
        req.userCanDelete   = true;
        req.userCanApprove  = true;
        req.userCanComplete = true;
        return next();
      }

      // Check user permissions and overrides for creative_hub module
      let canView     = 0;
      let canCreate   = 0;
      let canEdit     = 0;
      let canDelete   = 0;
      let canApprove  = 0;
      let canComplete = 0;

      // 1. Get role baseline for creative_hub
      const [userRows] = await db.query(
        'SELECT role_id FROM users WHERE id = ? AND deleted = 0',
        [req.user.id]
      );

      const roleId = userRows.length ? userRows[0].role_id : null;
      if (roleId) {
        try {
          const [rolePerms] = await db.query(
            'SELECT can_view, can_create, can_edit, can_delete, can_approve, can_complete FROM role_permissions WHERE role_id = ? AND module = "creative_hub"',
            [roleId]
          );
          if (rolePerms && rolePerms.length) {
            canView     = rolePerms[0].can_view || 0;
            canCreate   = rolePerms[0].can_create || 0;
            canEdit     = rolePerms[0].can_edit || 0;
            canDelete   = rolePerms[0].can_delete || 0;
            canApprove  = rolePerms[0].can_approve || 0;
            canComplete = rolePerms[0].can_complete || 0;
          }
        } catch (e) {
          try {
            const [rolePerms] = await db.query(
              'SELECT can_view, can_create, can_edit, can_delete, can_approve FROM role_permissions WHERE role_id = ? AND module = "creative_hub"',
              [roleId]
            );
            if (rolePerms && rolePerms.length) {
              canView    = rolePerms[0].can_view || 0;
              canCreate  = rolePerms[0].can_create || 0;
              canEdit    = rolePerms[0].can_edit || 0;
              canDelete  = rolePerms[0].can_delete || 0;
              canApprove = rolePerms[0].can_approve || 0;
            }
          } catch (e2) {}
        }
      }

      // 2. User module overrides (if any)
      try {
        const [userPerms] = await db.query(
          'SELECT can_view, can_create, can_edit, can_delete, can_approve, can_complete FROM user_permissions WHERE user_id = ? AND module = "creative_hub"',
          [req.user.id]
        );
        if (userPerms && userPerms.length) {
          if (userPerms[0].can_view !== null && userPerms[0].can_view !== undefined) canView = userPerms[0].can_view;
          if (userPerms[0].can_create !== null && userPerms[0].can_create !== undefined) canCreate = userPerms[0].can_create;
          if (userPerms[0].can_edit !== null && userPerms[0].can_edit !== undefined) canEdit = userPerms[0].can_edit;
          if (userPerms[0].can_delete !== null && userPerms[0].can_delete !== undefined) canDelete = userPerms[0].can_delete;
          if (userPerms[0].can_approve !== null && userPerms[0].can_approve !== undefined) canApprove = userPerms[0].can_approve;
          if (userPerms[0].can_complete !== null && userPerms[0].can_complete !== undefined) canComplete = userPerms[0].can_complete;
        }
      } catch (e) {
        try {
          const [userPerms] = await db.query(
            'SELECT can_view, can_create, can_edit, can_delete, can_approve FROM user_permissions WHERE user_id = ? AND module = "creative_hub"',
            [req.user.id]
          );
          if (userPerms && userPerms.length) {
            if (userPerms[0].can_view !== null && userPerms[0].can_view !== undefined) canView = userPerms[0].can_view;
            if (userPerms[0].can_create !== null && userPerms[0].can_create !== undefined) canCreate = userPerms[0].can_create;
            if (userPerms[0].can_edit !== null && userPerms[0].can_edit !== undefined) canEdit = userPerms[0].can_edit;
            if (userPerms[0].can_delete !== null && userPerms[0].can_delete !== undefined) canDelete = userPerms[0].can_delete;
            if (userPerms[0].can_approve !== null && userPerms[0].can_approve !== undefined) canApprove = userPerms[0].can_approve;
          }
        } catch (e2) {}
      }

      // 3. Submenu access resolution:
      // Priority 1: user_submenu_permissions (user override)
      // Priority 2: role_submenu_permissions
      // Priority 3: role_social_permissions (legacy)
      let accessLevel = 0;
      let hasSubmenuSetting = false;

      try {
        const [userSub] = await db.query(
          'SELECT can_access FROM user_submenu_permissions WHERE user_id = ? AND module = "creative_hub" AND submenu = ?',
          [req.user.id, submenu]
        );
        if (userSub.length > 0 && userSub[0].can_access !== null) {
          accessLevel = userSub[0].can_access;
          hasSubmenuSetting = true;
        }
      } catch (e) {}

      if (!hasSubmenuSetting && roleId) {
        try {
          const [roleSub] = await db.query(
            'SELECT can_access FROM role_submenu_permissions WHERE role_id = ? AND module = "creative_hub" AND submenu = ?',
            [roleId, submenu]
          );
          if (roleSub.length > 0 && roleSub[0].can_access !== null) {
            accessLevel = roleSub[0].can_access;
            hasSubmenuSetting = true;
          }
        } catch (e) {}

        if (!hasSubmenuSetting) {
          try {
            const [legacyRows] = await db.query(
              `SELECT ${submenu} AS access_level FROM role_social_permissions WHERE role_id = ?`,
              [roleId]
            );
            if (legacyRows.length > 0 && legacyRows[0].access_level !== null) {
              accessLevel = legacyRows[0].access_level;
              hasSubmenuSetting = true;
            }
          } catch (e) {}
        }
      }

      // If submenu level wasn't explicitly set but module has view or edit access, infer access
      if (!hasSubmenuSetting && (canView > 0 || canEdit > 0)) {
        accessLevel = canView || (canEdit ? 2 : 1);
      }

      // Check access: allowed if submenu access >= 1 OR module has view/edit
      if (accessLevel < 1 && canView < 1 && canEdit < 1) {
        return res.status(403).json({ message: 'You do not have access to this section.' });
      }

      req.socialAccessLevel = accessLevel;
      req.userCanView     = canView > 0;
      req.userCanCreate   = canCreate > 0;
      req.userCanEdit     = canEdit > 0;
      req.userCanDelete   = canDelete > 0;
      req.userCanApprove  = canApprove > 0;
      req.userCanComplete = canComplete > 0;

      next();
    } catch (err) {
      console.error('requireSocialAccess error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

module.exports = { requireSocialAccess };
