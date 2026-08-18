const db = require('../config/db');

/**
 * GET /api/social-overview/projects
 * Returns social project tracking list with aggregated data
 */
exports.getProjects = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;
    const { month_year, status, project_type, search } = req.query;

    let where = 'WHERE spt.id IS NOT NULL';
    const params = [];

    if (month_year) {
      where += ' AND spt.month_year = ?';
      params.push(month_year);
    }
    if (status) {
      where += ' AND spt.status = ?';
      params.push(status);
    }
    if (project_type) {
      where += ' AND spt.project_type = ?';
      params.push(project_type);
    }
    if (search) {
      where += ' AND (p.title LIKE ? OR l.business_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Non-admin: only projects they are members of
    if (!isAdmin) {
      where += ' AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)';
      params.push(userId);
    }

    const [rows] = await db.query(
      `SELECT spt.id, spt.project_id, spt.service_type, spt.project_type,
              spt.video_target, spt.video_done, spt.poster_target, spt.poster_done,
              spt.platforms, spt.status, spt.month_year, spt.notes,
              p.title AS project_name,
              l.business_name AS client_name
       FROM social_project_tracking spt
       JOIN projects p ON p.id = spt.project_id AND p.deleted = 0
       LEFT JOIN leads l ON l.id = p.client_id
       ${where}
       ORDER BY spt.id ASC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('Social overview getProjects error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/social-overview/summary
 * Returns summary cards data
 */
exports.getSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;
    const { month_year } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (month_year) {
      where += ' AND spt.month_year = ?';
      params.push(month_year);
    }

    if (!isAdmin) {
      where += ' AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)';
      params.push(userId);
    }

    // Total projects, totals by type, totals creatives
    const [summary] = await db.query(
      `SELECT
         COUNT(*) AS total_projects,
         SUM(CASE WHEN spt.status = 'Active' THEN 1 ELSE 0 END) AS active_projects,
         SUM(CASE WHEN spt.project_type = 'Internal' THEN 1 ELSE 0 END) AS internal_count,
         SUM(CASE WHEN spt.project_type = 'External' THEN 1 ELSE 0 END) AS external_count,
         SUM(spt.video_done) AS total_videos,
         SUM(spt.poster_done) AS total_posters,
         SUM(spt.video_done + spt.poster_done) AS total_creatives,
         SUM(spt.video_target) AS total_video_target,
         SUM(spt.poster_target) AS total_poster_target,
         SUM(spt.video_target + spt.poster_target) AS total_creative_target
       FROM social_project_tracking spt
       JOIN projects p ON p.id = spt.project_id AND p.deleted = 0
       ${where}`,
      params
    );

    // Service type breakdown
    const [serviceBreakdown] = await db.query(
      `SELECT spt.service_type, COUNT(*) AS count
       FROM social_project_tracking spt
       JOIN projects p ON p.id = spt.project_id AND p.deleted = 0
       ${where}
       GROUP BY spt.service_type`,
      params
    );

    // Platform breakdown
    const [platformRows] = await db.query(
      `SELECT spt.platforms
       FROM social_project_tracking spt
       JOIN projects p ON p.id = spt.project_id AND p.deleted = 0
       ${where}`,
      params
    );

    // Count each platform occurrence
    const platformCounts = {};
    platformRows.forEach(row => {
      if (row.platforms) {
        row.platforms.split('/').map(p => p.trim().toUpperCase()).filter(Boolean).forEach(plat => {
          platformCounts[plat] = (platformCounts[plat] || 0) + 1;
        });
      }
    });

    return res.json({
      ...summary[0],
      service_breakdown: serviceBreakdown,
      platform_breakdown: platformCounts,
    });
  } catch (err) {
    console.error('Social overview getSummary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/social-overview/projects
 * Create a new social project tracking entry
 */
exports.createProject = async (req, res) => {
  try {
    const { project_id, service_type, project_type, video_target, poster_target, platforms, status, month_year, notes } = req.body;

    if (!project_id || !month_year) {
      return res.status(400).json({ message: 'project_id and month_year are required' });
    }

    const [result] = await db.query(
      `INSERT INTO social_project_tracking (project_id, service_type, project_type, video_target, video_done, poster_target, poster_done, platforms, status, month_year, notes, created_by)
       VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?)`,
      [
        project_id,
        service_type || 'SMM',
        project_type || 'External',
        video_target || 0,
        poster_target || 0,
        platforms || null,
        status || 'Active',
        month_year,
        notes || null,
        req.user.id,
      ]
    );

    return res.status(201).json({ id: result.insertId, message: 'Project tracking entry created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This project already has an entry for this month' });
    }
    console.error('Social overview createProject error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/social-overview/projects/:id
 * Update a social project tracking entry
 */
exports.updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { service_type, project_type, video_target, video_done, poster_target, poster_done, platforms, status, notes } = req.body;

    const fields = [];
    const params = [];

    if (service_type !== undefined) { fields.push('service_type = ?'); params.push(service_type); }
    if (project_type !== undefined) { fields.push('project_type = ?'); params.push(project_type); }
    if (video_target !== undefined) { fields.push('video_target = ?'); params.push(video_target); }
    if (video_done !== undefined) { fields.push('video_done = ?'); params.push(video_done); }
    if (poster_target !== undefined) { fields.push('poster_target = ?'); params.push(poster_target); }
    if (poster_done !== undefined) { fields.push('poster_done = ?'); params.push(poster_done); }
    if (platforms !== undefined) { fields.push('platforms = ?'); params.push(platforms); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    params.push(id);
    await db.query(`UPDATE social_project_tracking SET ${fields.join(', ')} WHERE id = ?`, params);

    return res.json({ message: 'Updated successfully' });
  } catch (err) {
    console.error('Social overview updateProject error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/social-overview/projects/:id
 * Delete a social project tracking entry
 */
exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM social_project_tracking WHERE id = ?', [id]);
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Social overview deleteProject error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/social-overview/projects/:id/inline
 * Inline update for video_done / poster_done counts
 */
exports.inlineUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { video_done, poster_done } = req.body;

    const fields = [];
    const params = [];

    if (video_done !== undefined) { fields.push('video_done = ?'); params.push(video_done); }
    if (poster_done !== undefined) { fields.push('poster_done = ?'); params.push(poster_done); }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    params.push(id);
    await db.query(`UPDATE social_project_tracking SET ${fields.join(', ')} WHERE id = ?`, params);

    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Social overview inlineUpdate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/social-overview/projects-list
 * Returns list of active projects for the add modal dropdown
 */
exports.getProjectsList = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;

    let where = "WHERE p.deleted = 0 AND p.status IN ('open','in_progress')";
    if (!isAdmin) {
      where += ` AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})`;
    }

    const [rows] = await db.query(
      `SELECT p.id, p.title, l.business_name AS client_name
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       ${where}
       ORDER BY p.title ASC`
    );

    return res.json(rows);
  } catch (err) {
    console.error('Social overview getProjectsList error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
