const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Allocation sheets are stored per Project ▸ Service (project_service_id).
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise a project_service_id value to a positive int or null. */
function toServiceId(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** SQL fragment + params that scope a query to one service (or the legacy NULL row). */
function serviceFilter(v, alias = '') {
  const col = `${alias}project_service_id`;
  const id = toServiceId(v);
  return id
    ? { clause: ` AND ${col} = ?`, params: [id] }
    : { clause: ` AND ${col} IS NULL`, params: [] };
}

function parseSheetJson(sheet) {
  if (sheet.platforms_managed && typeof sheet.platforms_managed === 'string') {
    sheet.platforms_managed = JSON.parse(sheet.platforms_managed);
  }
  if (sheet.shoot_sessions && typeof sheet.shoot_sessions === 'string') {
    sheet.shoot_sessions = JSON.parse(sheet.shoot_sessions);
  }
  if (sheet.team_allocation && typeof sheet.team_allocation === 'string') {
    sheet.team_allocation = JSON.parse(sheet.team_allocation);
  }
  return sheet;
}

/**
 * Startup migration (idempotent, MariaDB syntax):
 *  - adds project_service_id
 *  - replaces UNIQUE(project_id) with UNIQUE(project_id, project_service_id)
 *  - assigns existing sheets (which were SMM sheets) to the project's SMM service
 */
exports.ensureSchema = async () => {
  try {
    await db.query(
      'ALTER TABLE project_allocation_sheets ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL AFTER project_id'
    );
    await db.query(
      'ALTER TABLE project_allocation_sheets ADD UNIQUE INDEX IF NOT EXISTS uq_project_service_allocation (project_id, project_service_id)'
    );
    await db.query('ALTER TABLE project_allocation_sheets DROP INDEX IF EXISTS uq_project_allocation');
    await db.query(
      `UPDATE project_allocation_sheets pas
         JOIN project_services ps ON ps.project_id = pas.project_id
         JOIN services s ON s.id = ps.service_id
          SET pas.project_service_id = ps.id
        WHERE pas.project_service_id IS NULL
          AND LOWER(s.name) IN ('smm', 'social media marketing')`
    );
    console.log('[allocation] project_service_id column verified');
  } catch (err) {
    console.error('[allocation] ensureSchema failed (non-fatal):', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:id/allocation?project_service_id=
// ─────────────────────────────────────────────────────────────────────────────
exports.get = async (req, res) => {
  try {
    const projectId = req.params.id;
    const { clause, params } = serviceFilter(req.query.project_service_id, 'pas.');

    const [rows] = await db.query(
      `SELECT pas.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM project_allocation_sheets pas
       LEFT JOIN users u ON u.id = pas.created_by
       WHERE pas.project_id = ?${clause}`,
      [projectId, ...params]
    );

    if (rows.length === 0) {
      return res.json(null);
    }

    const sheet = parseSheetJson(rows[0]);

    // Resolve team member names
    if (sheet.team_allocation && Array.isArray(sheet.team_allocation)) {
      const userIds = sheet.team_allocation
        .filter(t => t.user_id)
        .map(t => t.user_id);

      if (userIds.length > 0) {
        const [users] = await db.query(
          `SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id IN (?)`,
          [userIds]
        );
        const userMap = {};
        users.forEach(u => { userMap[u.id] = u.name; });
        sheet.team_allocation = sheet.team_allocation.map(t => ({
          ...t,
          user_name: userMap[t.user_id] || null,
        }));
      }
    }

    return res.json(sheet);
  } catch (err) {
    console.error('Project allocation get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:id/allocation — create or update allocation sheet
// body.project_service_id selects the service the sheet belongs to
// ─────────────────────────────────────────────────────────────────────────────
exports.save = async (req, res) => {
  try {
    const projectId = req.params.id;
    const psId = toServiceId(req.body.project_service_id);

    // Verify project exists
    const [project] = await db.query(
      'SELECT id FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Verify the service belongs to this project
    if (psId) {
      const [svc] = await db.query(
        'SELECT id FROM project_services WHERE id = ? AND project_id = ?',
        [psId, projectId]
      );
      if (svc.length === 0) {
        return res.status(400).json({ message: 'Service does not belong to this project' });
      }
    }

    const {
      primary_contact_name,
      primary_contact_mobile,
      secondary_contact_name,
      secondary_contact_mobile,
      platforms_managed,
      commitment_reels,
      commitment_static_posts,
      commitment_stories,
      commitment_content_calendar,
      commitment_insight_report,
      commitment_strategy_call,
      shoot_sessions,
      community_management_frequency,
      ads_pre_ad_report,
      ads_post_ad_report,
      team_allocation,
      special_notes,
    } = req.body;

    const data = {
      project_id: projectId,
      project_service_id: psId,
      primary_contact_name: primary_contact_name || null,
      primary_contact_mobile: primary_contact_mobile || null,
      secondary_contact_name: secondary_contact_name || null,
      secondary_contact_mobile: secondary_contact_mobile || null,
      platforms_managed: platforms_managed ? JSON.stringify(platforms_managed) : null,
      commitment_reels: commitment_reels || 0,
      commitment_static_posts: commitment_static_posts || 0,
      commitment_stories: commitment_stories || null,
      commitment_content_calendar: commitment_content_calendar || null,
      commitment_insight_report: commitment_insight_report || null,
      commitment_strategy_call: commitment_strategy_call || null,
      shoot_sessions: shoot_sessions ? JSON.stringify(shoot_sessions) : null,
      community_management_frequency: community_management_frequency || 'Daily',
      ads_pre_ad_report: ads_pre_ad_report ? 1 : 0,
      ads_post_ad_report: ads_post_ad_report ? 1 : 0,
      team_allocation: team_allocation ? JSON.stringify(team_allocation) : null,
      special_notes: special_notes || null,
      created_by: req.user.id,
    };

    // Check if allocation already exists for this project + service
    const { clause, params } = serviceFilter(psId);
    const [existing] = await db.query(
      `SELECT id FROM project_allocation_sheets WHERE project_id = ?${clause}`,
      [projectId, ...params]
    );

    if (existing.length > 0) {
      // Update
      const { project_id, project_service_id, created_by, ...updateData } = data;
      const setClauses = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updateData), existing[0].id];
      await db.query(
        `UPDATE project_allocation_sheets SET ${setClauses} WHERE id = ?`,
        values
      );
    } else {
      // Insert
      const columns = Object.keys(data).join(', ');
      const placeholders = Object.keys(data).map(() => '?').join(', ');
      await db.query(
        `INSERT INTO project_allocation_sheets (${columns}) VALUES (${placeholders})`,
        Object.values(data)
      );
    }

    // Return the saved data
    const [saved] = await db.query(
      `SELECT * FROM project_allocation_sheets WHERE project_id = ?${clause}`,
      [projectId, ...params]
    );

    const result = parseSheetJson(saved[0]);

    res.emitSocket('project-allocation:updated', { project_id: projectId, project_service_id: psId });
    return res.json(result);
  } catch (err) {
    console.error('Project allocation save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
