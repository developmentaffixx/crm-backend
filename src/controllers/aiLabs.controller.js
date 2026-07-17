const db = require('../config/db');

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
const AI_CATEGORIES = [
  'general', 'content_writing', 'design', 'video', 'marketing',
  'development', 'productivity', 'research', 'social_media', 'analytics',
  'automation', 'customer_support', 'hr', 'finance', 'education', 'other'
];

// ─── POINTS CONFIG ───────────────────────────────────────────────────────────
const POINTS = {
  tool_test: 10,
  report_submitted: 15,
  report_approved: 25,
  streak_bonus_7: 50,
  streak_bonus_30: 200,
  implementation: 30,
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL TESTS (Daily Testing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai-labs/tests
 * List all tool tests (feed) — with upvote count and user info
 */
exports.listTests = async (req, res) => {
  try {
    const { category, user_id, date } = req.query;
    let sql = `
      SELECT t.*, 
             CONCAT(u.first_name, ' ', u.last_name) AS user_name,
             u.avatar_url AS user_avatar,
             u.designation AS user_designation,
             (SELECT COUNT(*) FROM ai_upvotes uv WHERE uv.test_id = t.id) AS upvote_count,
             (SELECT COUNT(*) FROM ai_upvotes uv WHERE uv.test_id = t.id AND uv.user_id = ?) AS user_upvoted,
             (SELECT COUNT(*) FROM ai_comments c WHERE c.test_id = t.id AND c.deleted = 0) AS comment_count
      FROM ai_tool_tests t
      INNER JOIN users u ON u.id = t.user_id
      WHERE t.deleted = 0
    `;
    const params = [req.user.id];

    if (category && category !== 'all') {
      sql += ' AND t.category = ?';
      params.push(category);
    }
    if (user_id) {
      sql += ' AND t.user_id = ?';
      params.push(user_id);
    }
    if (date) {
      sql += ' AND t.test_date = ?';
      params.push(date);
    }

    sql += ' ORDER BY t.created_at DESC LIMIT 100';

    const [rows] = await db.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('AI Labs listTests error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/ai-labs/tests
 * Log a new tool test
 */
exports.createTest = async (req, res) => {
  try {
    const { tool_name, tool_url, category, rating, summary, use_case, screenshot_url } = req.body;
    if (!tool_name) return res.status(400).json({ message: 'Tool name is required' });

    // Check if tool already exists in library — show info but allow additional test
    let toolId = null;
    const [existingTool] = await db.query(
      'SELECT id FROM ai_tools WHERE LOWER(name) = LOWER(?) AND deleted = 0 LIMIT 1',
      [tool_name.trim()]
    );

    if (existingTool.length > 0) {
      toolId = existingTool[0].id;
    } else {
      // Add to tool library
      const [toolResult] = await db.query(
        'INSERT INTO ai_tools (name, url, category, description, added_by) VALUES (?, ?, ?, ?, ?)',
        [tool_name.trim(), tool_url || null, category || 'general', summary || null, req.user.id]
      );
      toolId = toolResult.insertId;
    }

    // Create test entry
    const [result] = await db.query(
      `INSERT INTO ai_tool_tests (user_id, tool_id, tool_name, tool_url, category, rating, summary, use_case, screenshot_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, toolId, tool_name.trim(), tool_url || null, category || 'general', rating || null, summary || null, use_case || null, screenshot_url || null]
    );

    // Award points
    await awardPoints(req.user.id, 'tool_test', result.insertId, POINTS.tool_test);

    // Update streak
    await updateStreak(req.user.id);

    return res.status(201).json({ message: 'Tool test logged', id: result.insertId, tool_id: toolId });
  } catch (err) {
    console.error('AI Labs createTest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/ai-labs/tests/:id
 * Update own test entry
 */
exports.updateTest = async (req, res) => {
  try {
    const { id } = req.params;
    const { tool_name, tool_url, category, rating, summary, use_case, screenshot_url } = req.body;

    const [existing] = await db.query('SELECT id, user_id FROM ai_tool_tests WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });
    if (existing[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await db.query(
      `UPDATE ai_tool_tests SET tool_name = ?, tool_url = ?, category = ?, rating = ?, summary = ?, use_case = ?, screenshot_url = ? WHERE id = ?`,
      [tool_name, tool_url || null, category || 'general', rating || null, summary || null, use_case || null, screenshot_url || null, id]
    );

    return res.json({ message: 'Test updated' });
  } catch (err) {
    console.error('AI Labs updateTest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/ai-labs/tests/:id
 * Soft delete own test
 */
exports.deleteTest = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT user_id FROM ai_tool_tests WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });
    if (existing[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await db.query('UPDATE ai_tool_tests SET deleted = 1 WHERE id = ?', [id]);
    return res.json({ message: 'Test deleted' });
  } catch (err) {
    console.error('AI Labs deleteTest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ai-labs/tests/:id/check-existing
 * Check if a tool has already been tested (shows who tested it + allows adding additional review)
 */
exports.checkExisting = async (req, res) => {
  try {
    const { tool_name } = req.query;
    if (!tool_name) return res.json({ exists: false, testers: [] });

    const [rows] = await db.query(
      `SELECT t.id, t.user_id, CONCAT(u.first_name, ' ', u.last_name) AS user_name, t.test_date, t.rating, t.summary
       FROM ai_tool_tests t
       INNER JOIN users u ON u.id = t.user_id
       WHERE LOWER(t.tool_name) = LOWER(?) AND t.deleted = 0
       ORDER BY t.created_at DESC`,
      [tool_name.trim()]
    );

    return res.json({ exists: rows.length > 0, testers: rows });
  } catch (err) {
    console.error('AI Labs checkExisting error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPVOTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ai-labs/tests/:id/upvote
 * Toggle upvote on a test
 */
exports.toggleUpvote = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query(
      'SELECT id FROM ai_upvotes WHERE test_id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (existing.length > 0) {
      await db.query('DELETE FROM ai_upvotes WHERE test_id = ? AND user_id = ?', [id, req.user.id]);
      return res.json({ upvoted: false });
    } else {
      await db.query('INSERT INTO ai_upvotes (test_id, user_id) VALUES (?, ?)', [id, req.user.id]);
      return res.json({ upvoted: true });
    }
  } catch (err) {
    console.error('AI Labs toggleUpvote error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai-labs/tests/:id/comments
 */
exports.listComments = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name, u.avatar_url AS user_avatar
       FROM ai_comments c
       INNER JOIN users u ON u.id = c.user_id
       WHERE c.test_id = ? AND c.deleted = 0
       ORDER BY c.created_at ASC`,
      [id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('AI Labs listComments error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/ai-labs/tests/:id/comments
 */
exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    if (!comment || !comment.trim()) return res.status(400).json({ message: 'Comment is required' });

    const [result] = await db.query(
      'INSERT INTO ai_comments (test_id, user_id, comment) VALUES (?, ?, ?)',
      [id, req.user.id, comment.trim()]
    );

    return res.status(201).json({ message: 'Comment added', id: result.insertId });
  } catch (err) {
    console.error('AI Labs addComment error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai-labs/reports
 * List reports (admin sees all, users see own + approved)
 */
exports.listReports = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) AS author_name, u.avatar_url AS author_avatar,
             CONCAT(a.first_name, ' ', a.last_name) AS approver_name
      FROM ai_reports r
      INNER JOIN users u ON u.id = r.user_id
      LEFT JOIN users a ON a.id = r.approved_by
      WHERE r.deleted = 0
    `;
    const params = [];

    if (req.user.is_admin) {
      if (status && status !== 'all') {
        sql += ' AND r.status = ?';
        params.push(status);
      }
    } else {
      // Non-admin: see own reports + all approved reports
      sql += ' AND (r.user_id = ? OR r.status = ?)';
      params.push(req.user.id, 'approved');
      if (status && status !== 'all') {
        sql += ' AND r.status = ?';
        params.push(status);
      }
    }

    sql += ' ORDER BY r.created_at DESC';
    const [rows] = await db.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('AI Labs listReports error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/ai-labs/reports
 * Create a new report (status = draft or pending)
 */
exports.createReport = async (req, res) => {
  try {
    const { title, content, category, tool_id, submit } = req.body;
    if (!title || !content) return res.status(400).json({ message: 'Title and content are required' });

    const status = submit ? 'pending' : 'draft';
    const [result] = await db.query(
      `INSERT INTO ai_reports (user_id, title, content, category, tool_id, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, content, category || 'ai_tools', tool_id || null, status]
    );

    if (submit) {
      await awardPoints(req.user.id, 'report_submitted', result.insertId, POINTS.report_submitted);
    }

    return res.status(201).json({ message: 'Report created', id: result.insertId });
  } catch (err) {
    console.error('AI Labs createReport error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/ai-labs/reports/:id
 * Update own report
 */
exports.updateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, tool_id, submit } = req.body;

    const [existing] = await db.query('SELECT id, user_id, status FROM ai_reports WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });
    if (existing[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const newStatus = submit ? 'pending' : existing[0].status;
    await db.query(
      'UPDATE ai_reports SET title = ?, content = ?, category = ?, tool_id = ?, status = ? WHERE id = ?',
      [title, content, category || 'ai_tools', tool_id || null, newStatus, id]
    );

    return res.json({ message: 'Report updated' });
  } catch (err) {
    console.error('AI Labs updateReport error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/ai-labs/reports/:id/approve
 * Admin approves a report
 */
exports.approveReport = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT id, user_id, status FROM ai_reports WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });
    if (existing[0].status !== 'pending') return res.status(400).json({ message: 'Report is not pending' });

    await db.query(
      'UPDATE ai_reports SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
      ['approved', req.user.id, id]
    );

    // Award points to report author
    await awardPoints(existing[0].user_id, 'report_approved', id, POINTS.report_approved);

    return res.json({ message: 'Report approved' });
  } catch (err) {
    console.error('AI Labs approveReport error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/ai-labs/reports/:id/reject
 * Admin rejects a report
 */
exports.rejectReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_note } = req.body;

    const [existing] = await db.query('SELECT id, status FROM ai_reports WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });

    await db.query(
      'UPDATE ai_reports SET status = ?, rejection_note = ? WHERE id = ?',
      ['rejected', rejection_note || null, id]
    );

    return res.json({ message: 'Report rejected' });
  } catch (err) {
    console.error('AI Labs rejectReport error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/ai-labs/reports/:id
 */
exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT user_id FROM ai_reports WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });
    if (existing[0].user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await db.query('UPDATE ai_reports SET deleted = 1 WHERE id = ?', [id]);
    return res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('AI Labs deleteReport error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai-labs/tools
 * Browse all discovered tools
 */
exports.listTools = async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = `
      SELECT t.*, CONCAT(u.first_name, ' ', u.last_name) AS added_by_name,
             (SELECT COUNT(*) FROM ai_tool_tests tt WHERE tt.tool_id = t.id AND tt.deleted = 0) AS test_count,
             (SELECT ROUND(AVG(tt.rating), 1) FROM ai_tool_tests tt WHERE tt.tool_id = t.id AND tt.deleted = 0 AND tt.rating IS NOT NULL) AS avg_rating
      FROM ai_tools t
      INNER JOIN users u ON u.id = t.added_by
      WHERE t.deleted = 0
    `;
    const params = [];

    if (category && category !== 'all') {
      sql += ' AND t.category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (t.name LIKE ? OR t.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY test_count DESC, t.created_at DESC';
    const [rows] = await db.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('AI Labs listTools error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD & POINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ai-labs/leaderboard
 * Points leaderboard (visible to everyone)
 */
exports.leaderboard = async (req, res) => {
  try {
    const { period } = req.query; // 'week', 'month', 'all'
    let dateFilter = '';
    if (period === 'week') {
      dateFilter = 'AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
    } else if (period === 'month') {
      dateFilter = 'AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }

    const [rows] = await db.query(`
      SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, u.avatar_url, u.designation,
             COALESCE(SUM(p.points), 0) AS total_points,
             (SELECT current_streak FROM ai_streaks WHERE user_id = u.id) AS current_streak,
             (SELECT longest_streak FROM ai_streaks WHERE user_id = u.id) AS longest_streak,
             (SELECT COUNT(*) FROM ai_tool_tests t WHERE t.user_id = u.id AND t.deleted = 0) AS tools_tested
      FROM users u
      LEFT JOIN ai_points p ON p.user_id = u.id ${dateFilter}
      WHERE u.is_active = 1 AND u.deleted = 0
      GROUP BY u.id
      HAVING total_points > 0 OR tools_tested > 0
      ORDER BY total_points DESC, tools_tested DESC
      LIMIT 50
    `);

    return res.json(rows);
  } catch (err) {
    console.error('AI Labs leaderboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ai-labs/my-stats
 * Current user's stats
 */
exports.myStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const [[points]] = await db.query(
      'SELECT COALESCE(SUM(points), 0) AS total_points FROM ai_points WHERE user_id = ?', [userId]
    );
    const [[streak]] = await db.query(
      'SELECT current_streak, longest_streak, last_test_date FROM ai_streaks WHERE user_id = ?', [userId]
    );
    const [[testCount]] = await db.query(
      'SELECT COUNT(*) AS count FROM ai_tool_tests WHERE user_id = ? AND deleted = 0', [userId]
    );
    const [[reportCount]] = await db.query(
      'SELECT COUNT(*) AS count FROM ai_reports WHERE user_id = ? AND deleted = 0', [userId]
    );
    const [[todayTest]] = await db.query(
      'SELECT COUNT(*) AS count FROM ai_tool_tests WHERE user_id = ? AND test_date = CURDATE() AND deleted = 0', [userId]
    );

    return res.json({
      total_points: points.total_points,
      current_streak: streak?.current_streak || 0,
      longest_streak: streak?.longest_streak || 0,
      last_test_date: streak?.last_test_date || null,
      tools_tested: testCount.count,
      reports_written: reportCount.count,
      tested_today: todayTest.count > 0,
    });
  } catch (err) {
    console.error('AI Labs myStats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ai-labs/dashboard
 * Team-wide analytics
 */
exports.dashboard = async (req, res) => {
  try {
    const [[totalTools]] = await db.query('SELECT COUNT(*) AS count FROM ai_tools WHERE deleted = 0');
    const [[totalTests]] = await db.query('SELECT COUNT(*) AS count FROM ai_tool_tests WHERE deleted = 0');
    const [[monthTests]] = await db.query(
      'SELECT COUNT(*) AS count FROM ai_tool_tests WHERE deleted = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );
    const [[pendingReports]] = await db.query(
      "SELECT COUNT(*) AS count FROM ai_reports WHERE status = 'pending' AND deleted = 0"
    );

    // Category breakdown
    const [categories] = await db.query(
      'SELECT category, COUNT(*) AS count FROM ai_tool_tests WHERE deleted = 0 GROUP BY category ORDER BY count DESC'
    );

    // Top testers this month
    const [topTesters] = await db.query(`
      SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, u.avatar_url, COUNT(t.id) AS test_count
      FROM ai_tool_tests t
      INNER JOIN users u ON u.id = t.user_id
      WHERE t.deleted = 0 AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY u.id
      ORDER BY test_count DESC
      LIMIT 5
    `);

    return res.json({
      total_tools: totalTools.count,
      total_tests: totalTests.count,
      month_tests: monthTests.count,
      pending_reports: pendingReports.count,
      categories,
      top_testers: topTesters,
    });
  } catch (err) {
    console.error('AI Labs dashboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ai-labs/daily-nudge
 * Check if user has tested today — for reminder notification
 */
exports.dailyNudge = async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT COUNT(*) AS count FROM ai_tool_tests WHERE user_id = ? AND test_date = CURDATE() AND deleted = 0',
      [req.user.id]
    );
    return res.json({ tested_today: row.count > 0, tests_today: row.count });
  } catch (err) {
    console.error('AI Labs dailyNudge error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ai-labs/categories
 */
exports.getCategories = async (req, res) => {
  return res.json(AI_CATEGORIES);
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function awardPoints(userId, actionType, referenceId, points) {
  try {
    await db.query(
      'INSERT INTO ai_points (user_id, points, action_type, reference_id) VALUES (?, ?, ?, ?)',
      [userId, points, actionType, referenceId]
    );
  } catch (err) {
    console.error('Award points error:', err);
  }
}

async function updateStreak(userId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await db.query('SELECT * FROM ai_streaks WHERE user_id = ?', [userId]);

    if (rows.length === 0) {
      // First ever test
      await db.query(
        'INSERT INTO ai_streaks (user_id, current_streak, longest_streak, last_test_date) VALUES (?, 1, 1, ?)',
        [userId, today]
      );
      return;
    }

    const streak = rows[0];
    const lastDate = streak.last_test_date;

    if (lastDate === today) return; // Already counted today

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let newStreak = 1;
    if (lastDate === yesterdayStr) {
      newStreak = streak.current_streak + 1;
    }

    const longestStreak = Math.max(newStreak, streak.longest_streak);

    await db.query(
      'UPDATE ai_streaks SET current_streak = ?, longest_streak = ?, last_test_date = ? WHERE user_id = ?',
      [newStreak, longestStreak, today, userId]
    );

    // Streak bonus points
    if (newStreak === 7) {
      await awardPoints(userId, 'streak_bonus', null, POINTS.streak_bonus_7);
    } else if (newStreak === 30) {
      await awardPoints(userId, 'streak_bonus', null, POINTS.streak_bonus_30);
    }
  } catch (err) {
    console.error('Update streak error:', err);
  }
}
