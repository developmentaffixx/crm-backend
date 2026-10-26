const { validationResult } = require('express-validator');
const db = require('../config/db');
const ensureTeamTables = require('../config/ensureTeamTables');

// True when an error is "table does not exist" (MySQL ER_NO_SUCH_TABLE).
function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

/**
 * Attach the member list (with role + display info) to each team row.
 */
async function attachMembers(teams) {
  if (teams.length === 0) return teams;
  const ids = teams.map(t => t.id);
  const [members] = await db.query(
    `SELECT tm.team_id, tm.user_id, tm.role,
            CONCAT(u.first_name, ' ', u.last_name) AS name,
            u.avatar_url AS avatar,
            u.designation,
            u.department
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id IN (?) AND u.deleted = 0
      ORDER BY (tm.role = 'head') DESC, u.first_name, u.last_name`,
    [ids]
  );
  const byTeam = {};
  for (const m of members) {
    if (!byTeam[m.team_id]) byTeam[m.team_id] = [];
    byTeam[m.team_id].push({
      user_id: m.user_id,
      role: m.role,
      name: m.name,
      avatar: m.avatar,
      designation: m.designation,
      department: m.department,
    });
  }
  return teams.map(t => ({
    ...t,
    members: byTeam[t.id] || [],
    head_count: (byTeam[t.id] || []).filter(m => m.role === 'head').length,
    member_count: (byTeam[t.id] || []).length,
  }));
}

/**
 * GET /api/teams
 * Admin: list all non-deleted teams with their members.
 */
exports.list = async (req, res) => {
  try {
    const [teams] = await db.query(
      `SELECT id, name, description, created_at, updated_at
         FROM teams
        WHERE deleted = 0
        ORDER BY name`
    );
    const withMembers = await attachMembers(teams);
    return res.json({ teams: withMembers });
  } catch (err) {
    // Self-heal: tables missing on first run — create them and return empty.
    if (isMissingTable(err)) {
      await ensureTeamTables();
      return res.json({ teams: [] });
    }
    console.error('Teams list error:', err.message);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};

/**
 * Validate a members payload and ensure:
 *  - every user is active & not deleted
 *  - none already belongs to a DIFFERENT team (one team per user)
 *  - at least one head is present
 * Returns { ok: true, members } or { ok: false, status, message }.
 */
async function validateMembers(members, teamId /* nullable for create */) {
  if (!Array.isArray(members) || members.length === 0) {
    return { ok: false, status: 400, message: 'At least one member is required' };
  }

  const normalized = [];
  const seen = new Set();
  for (const m of members) {
    const uid = parseInt(m.user_id, 10);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    normalized.push({ user_id: uid, role: m.role === 'head' ? 'head' : 'member' });
  }

  if (normalized.length === 0) {
    return { ok: false, status: 400, message: 'At least one member is required' };
  }
  if (!normalized.some(m => m.role === 'head')) {
    return { ok: false, status: 400, message: 'At least one member must be set as Head' };
  }

  const userIds = normalized.map(m => m.user_id);

  // All users must be active & not deleted.
  const [activeRows] = await db.query(
    `SELECT id FROM users WHERE id IN (?) AND deleted = 0 AND is_active = 1`,
    [userIds]
  );
  if (activeRows.length !== userIds.length) {
    return { ok: false, status: 400, message: 'One or more selected users are inactive or no longer exist' };
  }

  // No user may already be in a different team.
  const [conflicts] = await db.query(
    `SELECT tm.user_id, CONCAT(u.first_name, ' ', u.last_name) AS name, t.name AS team_name
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       JOIN teams t ON t.id = tm.team_id AND t.deleted = 0
      WHERE tm.user_id IN (?) ${teamId ? 'AND tm.team_id <> ?' : ''}`,
    teamId ? [userIds, teamId] : [userIds]
  );
  if (conflicts.length > 0) {
    const c = conflicts[0];
    return {
      ok: false,
      status: 409,
      message: `${c.name} is already in team "${c.team_name}". A user can belong to only one team.`,
    };
  }

  return { ok: true, members: normalized };
}

/**
 * POST /api/teams
 * body: { name, description?, members: [{ user_id, role }] }
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const conn = await db.getConnection();
  try {
    const { name, description = null, members = [] } = req.body;

    const check = await validateMembers(members, null);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO teams (name, description, created_by) VALUES (?, ?, ?)`,
      [name.trim(), description, req.user.id]
    );
    const teamId = result.insertId;

    const values = check.members.map(m => [teamId, m.user_id, m.role]);
    await conn.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ?`,
      [values]
    );

    await conn.commit();
    return res.status(201).json({ message: 'Team created', id: teamId });
  } catch (err) {
    await conn.rollback();
    console.error('Team create error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    conn.release();
  }
};

/**
 * PUT /api/teams/:id
 * body: { name?, description?, members?: [{ user_id, role }] }
 * Members (if provided) fully replace the current membership.
 */
exports.update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const teamId = parseInt(req.params.id, 10);
  const conn = await db.getConnection();
  try {
    const [[team]] = await conn.query(
      `SELECT id FROM teams WHERE id = ? AND deleted = 0`,
      [teamId]
    );
    if (!team) {
      conn.release();
      return res.status(404).json({ message: 'Team not found' });
    }

    const { name, description, members } = req.body;

    let validated = null;
    if (members !== undefined) {
      const check = await validateMembers(members, teamId);
      if (!check.ok) {
        conn.release();
        return res.status(check.status).json({ message: check.message });
      }
      validated = check.members;
    }

    await conn.beginTransaction();

    const sets = [];
    const params = [];
    if (name !== undefined)        { sets.push('name = ?');        params.push(String(name).trim()); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (sets.length > 0) {
      params.push(teamId);
      await conn.query(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, params);
    }

    if (validated) {
      await conn.query(`DELETE FROM team_members WHERE team_id = ?`, [teamId]);
      const values = validated.map(m => [teamId, m.user_id, m.role]);
      await conn.query(`INSERT INTO team_members (team_id, user_id, role) VALUES ?`, [values]);
    }

    await conn.commit();
    return res.json({ message: 'Team updated' });
  } catch (err) {
    await conn.rollback();
    console.error('Team update error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    conn.release();
  }
};

/**
 * DELETE /api/teams/:id  (soft delete + drop memberships)
 */
exports.remove = async (req, res) => {
  const teamId = parseInt(req.params.id, 10);
  const conn = await db.getConnection();
  try {
    const [[team]] = await conn.query(
      `SELECT id FROM teams WHERE id = ? AND deleted = 0`,
      [teamId]
    );
    if (!team) {
      conn.release();
      return res.status(404).json({ message: 'Team not found' });
    }

    await conn.beginTransaction();
    await conn.query(`DELETE FROM team_members WHERE team_id = ?`, [teamId]);
    await conn.query(`UPDATE teams SET deleted = 1 WHERE id = ?`, [teamId]);
    await conn.commit();

    return res.json({ message: 'Team deleted' });
  } catch (err) {
    await conn.rollback();
    console.error('Team delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    conn.release();
  }
};

/**
 * GET /api/teams/available-users
 * Active users who are NOT yet in any team (for the "add member" picker).
 * Optional query ?team_id= to also include members already in that team.
 */
exports.availableUsers = async (req, res) => {
  const runQuery = () => {
    const teamId = req.query.team_id ? parseInt(req.query.team_id, 10) : null;
    // NOTE: `current_role` is a reserved keyword in MariaDB — alias as
    // `current_team_role` to avoid a SQL syntax error.
    return db.query(
      `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name,
              u.avatar_url AS avatar, u.designation, u.department,
              tm.team_id AS current_team_id, tm.role AS current_team_role
         FROM users u
         LEFT JOIN team_members tm ON tm.user_id = u.id
        WHERE u.deleted = 0 AND u.is_active = 1
          AND (tm.team_id IS NULL ${teamId ? 'OR tm.team_id = ?' : ''})
        ORDER BY u.first_name, u.last_name`,
      teamId ? [teamId] : []
    );
  };

  try {
    const [rows] = await runQuery();
    return res.json(rows);
  } catch (err) {
    // Self-heal: if the team tables are missing, create them and retry once.
    if (isMissingTable(err)) {
      try {
        await ensureTeamTables();
        const [rows] = await runQuery();
        return res.json(rows);
      } catch (retryErr) {
        console.error('Available users error (after ensure):', retryErr.message);
        return res.status(500).json({ message: 'Team tables could not be created: ' + retryErr.message });
      }
    }
    console.error('Available users error:', err.message);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
