const db = require('../config/db');

// Helper: safely query
const safeQuery = async (sql, params) => {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch (err) {
    console.warn('Portal V2 query warning:', err.message);
    return [];
  }
};

// ═══════════════════════════════════════════════════════════════
// CLIENT-FACING APIs
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/client-portal/services/:serviceType
 * Get service module data (Social Media, SEO, Ads, etc.)
 */
exports.getServiceModule = async (req, res) => {
  const clientId = req.clientUser.client_id;
  const { serviceType } = req.params;

  const allowed = ['social_media', 'performance_marketing', 'seo', 'personal_branding', 'website_development'];
  if (!allowed.includes(serviceType)) {
    return res.status(400).json({ message: 'Invalid service type' });
  }

  try {
    const updates = await safeQuery(
      'SELECT * FROM client_portal_service_updates WHERE client_id = ? AND service_type = ? ORDER BY section, sort_order',
      [clientId, serviceType]
    );

    // Group by section
    const sections = {};
    updates.forEach(u => {
      if (!sections[u.section]) sections[u.section] = [];
      sections[u.section].push(u);
    });

    return res.json({ serviceType, sections });
  } catch (err) {
    console.error('getServiceModule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/knowledge-hub
 * Educational content for clients
 */
exports.getKnowledgeHub = async (req, res) => {
  const { category } = req.query;
  try {
    let where = 'WHERE is_active = 1';
    const params = [];
    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }
    const rows = await safeQuery(
      `SELECT * FROM client_portal_knowledge ${where} ORDER BY sort_order, created_at DESC`,
      params
    );
    return res.json({ articles: rows });
  } catch (err) {
    console.error('getKnowledgeHub error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/weekly-updates
 * Weekly structured updates for the client
 */
exports.getWeeklyUpdates = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const rows = await safeQuery(
      'SELECT * FROM client_portal_weekly_updates WHERE client_id = ? ORDER BY week_start DESC LIMIT 12',
      [clientId]
    );
    return res.json({ updates: rows });
  } catch (err) {
    console.error('getWeeklyUpdates error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/upsell
 * Locked services / upselling suggestions
 */
exports.getUpsell = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const rows = await safeQuery(
      'SELECT * FROM client_portal_upsell WHERE client_id = ? AND is_active = 1 ORDER BY sort_order',
      [clientId]
    );
    return res.json({ opportunities: rows });
  } catch (err) {
    console.error('getUpsell error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/milestones
 * Client milestones & celebrations
 */
exports.getMilestones = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const rows = await safeQuery(
      'SELECT * FROM client_portal_milestones WHERE client_id = ? ORDER BY milestone_date DESC',
      [clientId]
    );
    return res.json({ milestones: rows });
  } catch (err) {
    console.error('getMilestones error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/milestones/:id/celebrate
 * Mark a milestone as celebrated (client has seen it)
 */
exports.celebrateMilestone = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    await db.query(
      'UPDATE client_portal_milestones SET is_celebrated = 1 WHERE id = ? AND client_id = ?',
      [req.params.id, clientId]
    );
    return res.json({ message: 'Celebrated!' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/behind-the-scenes
 * Behind-the-scenes work visibility
 */
exports.getBehindTheScenes = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const rows = await safeQuery(
      'SELECT * FROM client_portal_bts WHERE client_id = ? ORDER BY created_at DESC LIMIT 20',
      [clientId]
    );
    return res.json({ items: rows });
  } catch (err) {
    console.error('getBehindTheScenes error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════
// CRM-SIDE APIs (managing portal v2 data)
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/client-portal/service-updates
 * CRM adds service module content
 */
exports.addServiceUpdate = async (req, res) => {
  const { client_id, service_type, section, title, description, value, file_url, sort_order } = req.body;
  if (!client_id || !service_type || !section || !title) {
    return res.status(400).json({ message: 'client_id, service_type, section, and title required' });
  }
  try {
    await db.query(
      'INSERT INTO client_portal_service_updates (client_id, service_type, section, title, description, value, file_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [client_id, service_type, section, title, description || null, value || null, file_url || null, sort_order || 0]
    );
    return res.json({ message: 'Service update added' });
  } catch (err) {
    console.error('addServiceUpdate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/knowledge
 * CRM adds knowledge hub content (global, not per-client)
 */
exports.addKnowledge = async (req, res) => {
  const { title, description, category, content_type, content_url, content_html, thumbnail_url } = req.body;
  if (!title) return res.status(400).json({ message: 'title required' });
  try {
    await db.query(
      'INSERT INTO client_portal_knowledge (title, description, category, content_type, content_url, content_html, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, description || null, category || null, content_type || 'article', content_url || null, content_html || null, thumbnail_url || null]
    );
    return res.json({ message: 'Knowledge article added' });
  } catch (err) {
    console.error('addKnowledge error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/weekly-updates
 * CRM posts a weekly update for a client
 */
exports.addWeeklyUpdate = async (req, res) => {
  const { client_id, week_start, week_end, completed_tasks, current_progress, next_steps, blockers, summary } = req.body;
  if (!client_id || !week_start || !week_end) {
    return res.status(400).json({ message: 'client_id, week_start, week_end required' });
  }
  try {
    await db.query(
      'INSERT INTO client_portal_weekly_updates (client_id, week_start, week_end, completed_tasks, current_progress, next_steps, blockers, summary, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [client_id, week_start, week_end, JSON.stringify(completed_tasks || []), JSON.stringify(current_progress || []), JSON.stringify(next_steps || []), JSON.stringify(blockers || []), summary || null, req.user.id]
    );
    await db.query(
      "INSERT INTO client_portal_notifications (client_id, title, type) VALUES (?, 'Weekly update posted', 'info')",
      [client_id]
    );
    return res.json({ message: 'Weekly update added' });
  } catch (err) {
    console.error('addWeeklyUpdate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/upsell
 * CRM adds upselling opportunity
 */
exports.addUpsell = async (req, res) => {
  const { client_id, service_name, tagline, description, icon } = req.body;
  if (!client_id || !service_name) return res.status(400).json({ message: 'client_id and service_name required' });
  try {
    await db.query(
      'INSERT INTO client_portal_upsell (client_id, service_name, tagline, description, icon) VALUES (?, ?, ?, ?, ?)',
      [client_id, service_name, tagline || null, description || null, icon || '🔒']
    );
    return res.json({ message: 'Upsell added' });
  } catch (err) {
    console.error('addUpsell error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/milestones
 * CRM adds a milestone
 */
exports.addMilestone = async (req, res) => {
  const { client_id, title, description, icon, milestone_date } = req.body;
  if (!client_id || !title) return res.status(400).json({ message: 'client_id and title required' });
  try {
    await db.query(
      'INSERT INTO client_portal_milestones (client_id, title, description, icon, milestone_date) VALUES (?, ?, ?, ?, ?)',
      [client_id, title, description || null, icon || '🎉', milestone_date || null]
    );
    await db.query(
      "INSERT INTO client_portal_notifications (client_id, title, type) VALUES (?, ?, 'info')",
      [client_id, `🎉 New milestone: ${title}`]
    );
    return res.json({ message: 'Milestone added' });
  } catch (err) {
    console.error('addMilestone error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/behind-the-scenes
 * CRM adds BTS work
 */
exports.addBTS = async (req, res) => {
  const { client_id, title, description, category } = req.body;
  if (!client_id || !title) return res.status(400).json({ message: 'client_id and title required' });
  try {
    await db.query(
      'INSERT INTO client_portal_bts (client_id, title, description, category, created_by) VALUES (?, ?, ?, ?, ?)',
      [client_id, title, description || null, category || null, req.user.id]
    );
    return res.json({ message: 'BTS item added' });
  } catch (err) {
    console.error('addBTS error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
