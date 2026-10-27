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

/**
 * Checks if user has ticket approval permission (admin or can_approve on tickets module).
 */
async function canApproveTickets(user) {
  if (!user) return false;
  if (user.is_admin) return true;

  try {
    // User-level override wins over role
    const [userPerms] = await db.query(
      'SELECT can_approve FROM user_permissions WHERE user_id = ? AND module = ?',
      [user.id, 'tickets']
    );
    if (userPerms.length > 0) {
      return !!userPerms[0].can_approve;
    }

    // Role-level baseline
    const [userRole] = await db.query('SELECT role_id FROM users WHERE id = ?', [user.id]);
    if (userRole.length > 0 && userRole[0].role_id) {
      const [rolePerms] = await db.query(
        'SELECT can_approve FROM role_permissions WHERE role_id = ? AND module = ?',
        [userRole[0].role_id, 'tickets']
      );
      if (rolePerms.length > 0) {
        return !!rolePerms[0].can_approve;
      }
    }
  } catch (err) {
    console.error('canApproveTickets check error:', err);
  }

  return false;
}

/**
 * Allows admins or users with tickets can_approve permission.
 */
async function requireAdminOrTicketApprove(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (req.user.is_admin) {
    return next();
  }
  try {
    const allowed = await canApproveTickets(req.user);
    if (!allowed) {
      return res.status(403).json({ message: 'Ticket approvals access required' });
    }
    next();
  } catch (err) {
    console.error('requireAdminOrTicketApprove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Fetch effective permissions for a user on a given module,
 * taking user-level overrides into account with fallback to role permissions.
 */
async function getUserModulePermission(userId, module) {
  try {
    // 1. User-level override wins
    const [userPerms] = await db.query(
      'SELECT can_view, can_create, can_edit, can_delete, can_approve FROM user_permissions WHERE user_id = ? AND module = ?',
      [userId, module]
    );
    if (userPerms.length > 0) {
      return {
        can_view:    userPerms[0].can_view ?? 0,
        can_create:  userPerms[0].can_create ?? 0,
        can_edit:    userPerms[0].can_edit ?? 0,
        can_delete:  userPerms[0].can_delete ?? 0,
        can_approve: userPerms[0].can_approve ?? 0,
      };
    }

    // 2. Role-level baseline
    const [userRole] = await db.query('SELECT role_id FROM users WHERE id = ?', [userId]);
    if (userRole.length > 0 && userRole[0].role_id) {
      const [rolePerms] = await db.query(
        'SELECT can_view, can_create, can_edit, can_delete, can_approve FROM role_permissions WHERE role_id = ? AND module = ?',
        [userRole[0].role_id, module]
      );
      if (rolePerms.length > 0) {
        return {
          can_view:    rolePerms[0].can_view ?? 0,
          can_create:  rolePerms[0].can_create ?? 0,
          can_edit:    rolePerms[0].can_edit ?? 0,
          can_delete:  rolePerms[0].can_delete ?? 0,
          can_approve: rolePerms[0].can_approve ?? 0,
        };
      }
    }
  } catch (err) {
    console.error('getUserModulePermission error:', err);
  }

  return { can_view: 0, can_create: 0, can_edit: 0, can_delete: 0, can_approve: 0 };
}

/**
 * Checks if user has permission to edit a specific project or all projects.
 * - Admin: always true
 * - can_edit >= 2 (All): true for all projects
 * - can_edit === 1 (Own): true if user created the project or is a project member
 */
async function canEditProject(user, projectId) {
  if (!user) return false;
  if (user.is_admin) return true;

  const perms = await getUserModulePermission(user.id, 'projects');
  const canEdit = perms.can_edit ?? 0;

  if (canEdit >= 2) return true;
  if (canEdit === 1 && projectId) {
    const [proj] = await db.query(
      `SELECT p.id FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.id = ? AND (p.created_by = ? OR pm.user_id IS NOT NULL)
       LIMIT 1`,
      [user.id, projectId, user.id]
    );
    return proj.length > 0;
  }
  return false;
}

/**
 * Checks if user has permission to view a specific project or all projects.
 * - Admin: always true
 * - can_view >= 2 or can_edit >= 2: true
 * - can_view === 1 or can_edit === 1: true if user created the project or is a project member
 */
async function canViewProject(user, projectId) {
  if (!user) return false;
  if (user.is_admin) return true;

  const perms = await getUserModulePermission(user.id, 'projects');
  const canView = perms.can_view ?? 0;
  const canEdit = perms.can_edit ?? 0;

  if (canView >= 2 || canEdit >= 2) return true;
  if ((canView >= 1 || canEdit >= 1) && projectId) {
    const [proj] = await db.query(
      `SELECT p.id FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.id = ? AND (p.created_by = ? OR pm.user_id IS NOT NULL)
       LIMIT 1`,
      [user.id, projectId, user.id]
    );
    return proj.length > 0;
  }
  return false;
}

/**
 * Allows admins or users with attendance module permission.
 */
async function requireAdminOrAttendanceAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (req.user.is_admin) {
    return next();
  }
  try {
    const perms = await getUserModulePermission(req.user.id, 'attendance');
    if (perms.can_view >= 1 || perms.can_edit >= 1) {
      return next();
    }
    return res.status(403).json({ message: 'Attendance access required' });
  } catch (err) {
    console.error('requireAdminOrAttendanceAccess error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Checks if user has approval permission for projects (admin or can_approve on projects module).
 */
async function canApproveProjects(user) {
  if (!user) return false;
  if (user.is_admin) return true;

  const perms = await getUserModulePermission(user.id, 'projects');
  return !!(perms.can_approve);
}

/**
 * Middleware: requires admin or projects can_approve permission.
 */
async function requireAdminOrProjectApprove(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const allowed = await canApproveProjects(req.user);
  if (allowed) {
    return next();
  }
  return res.status(403).json({ message: 'Project approval permission required' });
}

/**
 * Checks if user has permission to manage announcements (admin or announcements module permission).
 */
async function canManageAnnouncements(user) {
  if (!user) return false;
  if (user.is_admin) return true;
  const perms = await getUserModulePermission(user.id, 'announcements');
  return perms.can_view >= 1 || perms.can_create >= 1 || perms.can_edit >= 1 || perms.can_delete >= 1;
}

/**
 * Allows admins or users with announcement module full access.
 */
async function requireAdminOrAnnouncementAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (req.user.is_admin) {
    return next();
  }
  try {
    const allowed = await canManageAnnouncements(req.user);
    if (allowed) {
      return next();
    }
    return res.status(403).json({ message: 'Announcement management access required' });
  } catch (err) {
    console.error('requireAdminOrAnnouncementAccess error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Returns the set of teams the given user is a HEAD of, and the member
 * user IDs they supervise across those teams.
 *
 * A "head" sees & approves tasks/tickets for every member of their team
 * (the head is counted as a member too, so their own id is included).
 *
 * @returns {Promise<{ isHead: boolean, teamIds: number[], memberIds: number[] }>}
 *   - isHead: true if the user leads at least one team
 *   - teamIds: ids of teams the user heads
 *   - memberIds: distinct user ids of every member of those teams (incl. the head)
 */
async function getTeamScopeForHead(userId) {
  const empty = { isHead: false, teamIds: [], memberIds: [] };
  if (!userId) return empty;

  try {
    // Which teams (not deleted) does this user head?
    const [headRows] = await db.query(
      `SELECT tm.team_id
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id AND t.deleted = 0
        WHERE tm.user_id = ? AND tm.role = 'head'`,
      [userId]
    );
    if (headRows.length === 0) return empty;

    const teamIds = headRows.map(r => r.team_id);

    // All members (any role) of those teams — this includes the head(s).
    const [memberRows] = await db.query(
      `SELECT DISTINCT tm.user_id
         FROM team_members tm
        WHERE tm.team_id IN (?)`,
      [teamIds]
    );
    const memberIds = memberRows.map(r => r.user_id);

    return { isHead: true, teamIds, memberIds };
  } catch (err) {
    console.error('getTeamScopeForHead error:', err);
    return empty;
  }
}

/**
 * True if `headUserId` heads a team that contains `targetUserId`.
 * Used to let a team head approve/act on items owned by their members.
 */
async function isHeadOfUser(headUserId, targetUserId) {
  if (!headUserId || !targetUserId) return false;
  try {
    const [rows] = await db.query(
      `SELECT 1
         FROM team_members head
         JOIN teams t          ON t.id = head.team_id AND t.deleted = 0
         JOIN team_members mem ON mem.team_id = head.team_id
        WHERE head.user_id = ? AND head.role = 'head'
          AND mem.user_id = ?
        LIMIT 1`,
      [headUserId, targetUserId]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('isHeadOfUser error:', err);
    return false;
  }
}

/**
 * True if `user` is a team head and the given task is ASSIGNED TO (primary or
 * collaborator) one of their team members. Used to let a head view/manage a
 * team member's task consistently across endpoints.
 * @param {object} user  req.user
 * @param {{id:number, assigned_to:number}} task  task row with id + assigned_to
 */
async function isTaskInHeadScope(user, task) {
  if (!user || !task) return false;
  try {
    const scope = await getTeamScopeForHead(user.id);
    if (!scope.isHead || scope.memberIds.length === 0) return false;
    if (scope.memberIds.includes(task.assigned_to)) return true;
    const [collab] = await db.query(
      'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id IN (?) LIMIT 1',
      [task.id, scope.memberIds]
    );
    return collab.length > 0;
  } catch (err) {
    console.error('isTaskInHeadScope error:', err);
    return false;
  }
}

/**
 * Factory for an approval guard that allows:
 *   - admins and global approvers (via `canApproveFn`), OR
 *   - a team head, but only when the record being actioned belongs to one of
 *     their team members.
 *
 * @param {(user)=>Promise<boolean>} canApproveFn  e.g. canApproveTasks / canApproveTickets
 * @param {(req)=>Promise<number[]>} ownerIdsFn    resolves the user id(s) that own the targeted record
 */
function approveOrTeamHeadGuard(canApproveFn, ownerIdsFn) {
  return async function (req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
    try {
      if (req.user.is_admin || (await canApproveFn(req.user))) return next();

      // Not a global approver — allow only if a head of the record's owner(s).
      const ownerIds = await ownerIdsFn(req);
      if (ownerIds && ownerIds.length > 0) {
        for (const ownerId of ownerIds) {
          if (await isHeadOfUser(req.user.id, ownerId)) return next();
        }
      }
      return res.status(403).json({ message: 'Approval permission required' });
    } catch (err) {
      console.error('approveOrTeamHeadGuard error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

module.exports = {
  authenticate,
  requireAdmin,
  canApproveTasks,
  requireAdminOrTaskApprove,
  canApproveTickets,
  requireAdminOrTicketApprove,
  getUserModulePermission,
  getTeamScopeForHead,
  isHeadOfUser,
  isTaskInHeadScope,
  approveOrTeamHeadGuard,
  canEditProject,
  canViewProject,
  canApproveProjects,
  requireAdminOrProjectApprove,
  requireAdminOrAttendanceAccess,
  canManageAnnouncements,
  requireAdminOrAnnouncementAccess,
};
