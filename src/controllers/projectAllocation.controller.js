const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:id/allocation — get allocation sheet for a project
// ─────────────────────────────────────────────────────────────────────────────
exports.get = async (req, res) => {
  try {
    const projectId = req.params.id;

    const [rows] = await db.query(
      `SELECT pas.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM project_allocation_sheets pas
       LEFT JOIN users u ON u.id = pas.created_by
       WHERE pas.project_id = ?`,
      [projectId]
    );

    if (rows.length === 0) {
      return res.json(null);
    }

    const sheet = rows[0];

    // Parse JSON fields
    if (sheet.platforms_managed && typeof sheet.platforms_managed === 'string') {
      sheet.platforms_managed = JSON.parse(sheet.platforms_managed);
    }
    if (sheet.team_allocation && typeof sheet.team_allocation === 'string') {
      sheet.team_allocation = JSON.parse(sheet.team_allocation);
    }

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
// ─────────────────────────────────────────────────────────────────────────────
exports.save = async (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project exists
    const [project] = await db.query(
      'SELECT id FROM projects WHERE id = ? AND deleted = 0',
      [projectId]
    );
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
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
      shoot_hours,
      community_dm_monitoring,
      community_comment_monitoring,
      community_review_monitoring,
      community_lead_escalation,
      ads_campaign_setup,
      ads_campaign_monitoring,
      ads_optimization,
      ads_reporting,
      team_allocation,
      special_notes,
    } = req.body;

    const data = {
      project_id: projectId,
      primary_contact_name: primary_contact_name || null,
      primary_contact_mobile: primary_contact_mobile || null,
      secondary_contact_name: secondary_contact_name || null,
      secondary_contact_mobile: secondary_contact_mobile || null,
      platforms_managed: platforms_managed ? JSON.stringify(platforms_managed) : null,
      commitment_reels: commitment_reels || 0,
      commitment_static_posts: commitment_static_posts || 0,
      commitment_stories: commitment_stories || 0,
      commitment_content_calendar: commitment_content_calendar || 0,
      commitment_insight_report: commitment_insight_report || 0,
      commitment_strategy_call: commitment_strategy_call || 0,
      shoot_sessions: shoot_sessions || null,
      shoot_hours: shoot_hours || null,
      community_dm_monitoring: community_dm_monitoring || 'Daily',
      community_comment_monitoring: community_comment_monitoring || 'Daily',
      community_review_monitoring: community_review_monitoring || 'Daily',
      community_lead_escalation: community_lead_escalation || 'Daily',
      ads_campaign_setup: ads_campaign_setup ? 1 : 0,
      ads_campaign_monitoring: ads_campaign_monitoring ? 1 : 0,
      ads_optimization: ads_optimization ? 1 : 0,
      ads_reporting: ads_reporting ? 1 : 0,
      team_allocation: team_allocation ? JSON.stringify(team_allocation) : null,
      special_notes: special_notes || null,
      created_by: req.user.id,
    };

    // Check if allocation already exists for this project
    const [existing] = await db.query(
      'SELECT id FROM project_allocation_sheets WHERE project_id = ?',
      [projectId]
    );

    if (existing.length > 0) {
      // Update
      const { project_id, created_by, ...updateData } = data;
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
      'SELECT * FROM project_allocation_sheets WHERE project_id = ?',
      [projectId]
    );

    const result = saved[0];
    if (result.platforms_managed && typeof result.platforms_managed === 'string') {
      result.platforms_managed = JSON.parse(result.platforms_managed);
    }
    if (result.team_allocation && typeof result.team_allocation === 'string') {
      result.team_allocation = JSON.parse(result.team_allocation);
    }

    res.emitSocket('project-allocation:updated', { project_id: projectId });
    return res.json(result);
  } catch (err) {
    console.error('Project allocation save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
