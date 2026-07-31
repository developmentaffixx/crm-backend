const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendRawEmail } = require('../services/email.service');

/**
 * Generate a random password (8 chars, alphanumeric + special)
 */
function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRM-SIDE APIs (for managing client portal from internal CRM)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/client-portal/create-credentials
 * Creates portal login for a client (auto-generates password)
 */
exports.createCredentials = async (req, res) => {
  const { client_id, login_email } = req.body;
  if (!client_id || !login_email) {
    return res.status(400).json({ message: 'client_id and login_email are required' });
  }

  try {
    // Check client exists (won lead)
    const [client] = await db.query(
      "SELECT id, name, email FROM leads WHERE id = ? AND deleted = 0 AND (status = 'Won' OR lead_stage = 'Won')",
      [client_id]
    );
    if (!client.length) return res.status(404).json({ message: 'Client not found' });

    // Check if credentials already exist
    const [existing] = await db.query(
      'SELECT id FROM client_portal_users WHERE client_id = ?', [client_id]
    );
    if (existing.length) {
      return res.status(409).json({ message: 'Portal credentials already exist for this client' });
    }

    // Generate password
    const plainPassword = generatePassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    await db.query(
      `INSERT INTO client_portal_users (client_id, login_email, password_hash, plain_password)
       VALUES (?, ?, ?, ?)`,
      [client_id, login_email, passwordHash, plainPassword]
    );

    return res.json({
      message: 'Portal credentials created successfully',
      credentials: { login_email, password: plainPassword }
    });
  } catch (err) {
    console.error('createCredentials error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This email is already in use' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/credentials/:clientId
 * Get portal credentials for a client (shows in CRM detail page)
 */
exports.getCredentials = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, client_id, login_email, plain_password, is_active, content_calendar_access,
              access_approvals, access_reports, access_files, access_meetings,
              access_roadmap, access_ideas, access_weekly_updates, access_milestones,
              access_behind_scenes, access_knowledge_hub, access_support,
              last_login_at, created_at
       FROM client_portal_users WHERE client_id = ?`,
      [req.params.clientId]
    );
    if (!rows.length) return res.json({ credentials: null });
    return res.json({ credentials: rows[0] });
  } catch (err) {
    // If columns don't exist yet (migration not run), fallback
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      const [rows] = await db.query(
        'SELECT id, client_id, login_email, plain_password, is_active, content_calendar_access, last_login_at, created_at FROM client_portal_users WHERE client_id = ?',
        [req.params.clientId]
      );
      if (!rows.length) return res.json({ credentials: null });
      return res.json({ credentials: rows[0] });
    }
    console.error('getCredentials error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/credentials/:clientId
 * Update portal credentials (regenerate password or change email)
 */
exports.updateCredentials = async (req, res) => {
  const { login_email, regenerate_password } = req.body;
  const { clientId } = req.params;

  try {
    const [existing] = await db.query(
      'SELECT id FROM client_portal_users WHERE client_id = ?', [clientId]
    );
    if (!existing.length) return res.status(404).json({ message: 'No credentials found' });

    let newPassword = null;
    const updates = [];
    const params = [];

    if (login_email) {
      updates.push('login_email = ?');
      params.push(login_email);
    }

    if (regenerate_password) {
      newPassword = generatePassword();
      const hash = await bcrypt.hash(newPassword, 10);
      updates.push('password_hash = ?', 'plain_password = ?');
      params.push(hash, newPassword);
    }

    if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    params.push(clientId);
    await db.query(
      `UPDATE client_portal_users SET ${updates.join(', ')} WHERE client_id = ?`,
      params
    );

    const [updated] = await db.query(
      'SELECT login_email, plain_password, is_active FROM client_portal_users WHERE client_id = ?',
      [clientId]
    );

    return res.json({
      message: 'Credentials updated',
      credentials: updated[0]
    });
  } catch (err) {
    console.error('updateCredentials error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/toggle-access/:clientId
 * Enable/disable client portal access
 */
exports.toggleAccess = async (req, res) => {
  const { is_active } = req.body;
  try {
    await db.query(
      'UPDATE client_portal_users SET is_active = ? WHERE client_id = ?',
      [is_active ? 1 : 0, req.params.clientId]
    );
    return res.json({ message: `Portal access ${is_active ? 'enabled' : 'disabled'}` });
  } catch (err) {
    console.error('toggleAccess error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/toggle-calendar/:clientId
 * Enable/disable content calendar visibility on client portal
 */
exports.toggleCalendarAccess = async (req, res) => {
  const { enabled } = req.body;
  try {
    await db.query(
      'UPDATE client_portal_users SET content_calendar_access = ? WHERE client_id = ?',
      [enabled ? 1 : 0, req.params.clientId]
    );
    return res.json({ message: `Content Calendar ${enabled ? 'enabled' : 'disabled'} for client portal`, content_calendar_access: enabled ? 1 : 0 });
  } catch (err) {
    console.error('toggleCalendarAccess error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/menu-access/:clientId
 * Update individual menu access toggles for a client's portal
 */
exports.updateMenuAccess = async (req, res) => {
  const { clientId } = req.params;
  const allowedFields = [
    'content_calendar_access', 'access_approvals', 'access_reports', 'access_files',
    'access_meetings', 'access_roadmap', 'access_ideas', 'access_weekly_updates',
    'access_milestones', 'access_behind_scenes', 'access_knowledge_hub', 'access_support'
  ];

  try {
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field] ? 1 : 0);
      }
    }

    if (updates.length === 0) return res.status(400).json({ message: 'No valid fields to update' });

    values.push(clientId);
    await db.query(
      `UPDATE client_portal_users SET ${updates.join(', ')} WHERE client_id = ?`,
      values
    );

    return res.json({ message: 'Menu access updated successfully' });
  } catch (err) {
    console.error('updateMenuAccess error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/send-credentials/:clientId
 * Send login credentials email to client
 */
exports.sendCredentials = async (req, res) => {
  const { clientId } = req.params;
  try {
    const [portalUser] = await db.query(
      'SELECT login_email, plain_password FROM client_portal_users WHERE client_id = ?',
      [clientId]
    );
    if (!portalUser.length) return res.status(404).json({ message: 'No credentials found' });

    const [client] = await db.query('SELECT name, business_name FROM leads WHERE id = ?', [clientId]);
    const clientName = client[0]?.business_name || client[0]?.name || 'Client';

    const { login_email, plain_password } = portalUser[0];
    const portalUrl = process.env.CLIENT_PORTAL_URL || 'http://localhost:5174';

    const html = `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #4C2C21 0%, #7a4433 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 24px;">Welcome to Your Growth Dashboard</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">AffixxMedia Client Portal</p>
        </div>
        <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #374151; font-size: 16px;">Hi <strong>${clientName}</strong>,</p>
          <p style="color: #6b7280;">Your Client Growth Dashboard is ready! Access your marketing updates, approvals, reports, and more — all in one place.</p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; color: #374151;"><strong>Portal URL:</strong> <a href="${portalUrl}" style="color: #4C2C21;">${portalUrl}</a></p>
            <p style="margin: 0 0 8px 0; color: #374151;"><strong>Login Email:</strong> ${login_email}</p>
            <p style="margin: 0; color: #374151;"><strong>Password:</strong> ${plain_password}</p>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Spend just 10 minutes a day staying updated on your marketing. We handle the heavy lifting.</p>
          <a href="${portalUrl}" style="display: inline-block; background: #4C2C21; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">Access Your Dashboard</a>
        </div>
      </div>
    `;

    await sendRawEmail({
      to: login_email,
      subject: `Your AffixxMedia Client Dashboard is Ready — ${clientName}`,
      html
    });

    return res.json({ message: 'Credentials sent successfully' });
  } catch (err) {
    console.error('sendCredentials error:', err);
    return res.status(500).json({ message: 'Failed to send email: ' + err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT-FACING APIs (for the client dashboard frontend)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/client-portal/login
 * Client portal login
 */
exports.clientLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_users WHERE login_email = ?',
      [email]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const portalUser = rows[0];

    // Check if access is disabled
    if (!portalUser.is_active) {
      return res.status(403).json({ message: 'access_disabled' });
    }

    const match = await bcrypt.compare(password, portalUser.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Get client info
    const [client] = await db.query(
      'SELECT id, name, business_name, email, phone FROM leads WHERE id = ?',
      [portalUser.client_id]
    );

    // Update last login
    await db.query(
      'UPDATE client_portal_users SET last_login_at = NOW() WHERE id = ?',
      [portalUser.id]
    );

    const payload = {
      id: portalUser.id,
      client_id: portalUser.client_id,
      email: portalUser.login_email,
      type: 'client_portal'
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

    // Build menu access object
    const menuAccess = {
      content_calendar: portalUser.content_calendar_access ? true : false,
      approvals: portalUser.access_approvals !== undefined ? !!portalUser.access_approvals : true,
      reports: portalUser.access_reports !== undefined ? !!portalUser.access_reports : true,
      files: portalUser.access_files !== undefined ? !!portalUser.access_files : true,
      meetings: portalUser.access_meetings !== undefined ? !!portalUser.access_meetings : true,
      roadmap: portalUser.access_roadmap !== undefined ? !!portalUser.access_roadmap : true,
      ideas: portalUser.access_ideas !== undefined ? !!portalUser.access_ideas : true,
      weekly_updates: portalUser.access_weekly_updates !== undefined ? !!portalUser.access_weekly_updates : true,
      milestones: portalUser.access_milestones !== undefined ? !!portalUser.access_milestones : true,
      behind_scenes: portalUser.access_behind_scenes !== undefined ? !!portalUser.access_behind_scenes : true,
      knowledge_hub: portalUser.access_knowledge_hub !== undefined ? !!portalUser.access_knowledge_hub : true,
      support: portalUser.access_support !== undefined ? !!portalUser.access_support : true,
    };

    return res.json({
      token,
      client: { ...(client[0] || {}), menuAccess },
    });
  } catch (err) {
    console.error('clientLogin error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Middleware to authenticate client portal tokens
 */
exports.authenticateClient = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'client_portal') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    // Verify still active
    const [rows] = await db.query(
      'SELECT id, client_id, login_email, is_active FROM client_portal_users WHERE id = ? AND is_active = 1',
      [decoded.id]
    );
    if (!rows.length) {
      return res.status(401).json({ message: 'Access revoked or account not found' });
    }

    req.clientUser = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/**
 * GET /api/client-portal/dashboard
 * Main dashboard data for the logged-in client
 * Pulls real data from CRM tables + portal-specific tables
 */
exports.getDashboard = async (req, res) => {
  const clientId = req.clientUser.client_id;

  // Helper: safely query, return empty array if table doesn't exist
  const safeQuery = async (sql, params) => {
    try {
      const [rows] = await db.query(sql, params);
      return rows;
    } catch (err) {
      console.warn('Dashboard query warning:', err.message);
      return [];
    }
  };

  try {
    // Parallelize all independent queries for faster dashboard load
    const [
      clientRows,
      services,
      recentTasks,
      recentTickets,
      recentShoots,
      portalActivities,
      projects,
      portalProgress,
      wins,
      pendingTasks,
      portalNextActions,
      portalTeam,
      brandHealthRows,
      approvalCountRows,
      pendingItems,
      crmMeetings,
      portalMeetings,
      notifCountRows,
      invoiceSummary,
      calendarAccessRows
    ] = await Promise.all([
      // Client info
      safeQuery('SELECT id, name, business_name, email, phone FROM leads WHERE id = ?', [clientId]),
      // Active services
      safeQuery(
        `SELECT cp.*, p.name as plan_name, s.name as service_name
         FROM client_plans cp
         LEFT JOIN plans p ON p.id = cp.plan_id
         LEFT JOIN services s ON s.id = cp.service_id
         WHERE cp.client_id = ? AND cp.status = 'active'`,
        [clientId]
      ),
      // Recent tasks
      safeQuery(
        `SELECT t.id, t.title, t.status, t.updated_at as created_at, 'task' as source
         FROM tasks t
         INNER JOIN project_tasks pt ON pt.task_id = t.id
         INNER JOIN projects p ON p.id = pt.project_id
         WHERE p.client_id = ? AND t.deleted = 0
         ORDER BY t.updated_at DESC LIMIT 5`,
        [clientId]
      ),
      // Recent tickets
      safeQuery(
        `SELECT id, title, status, updated_at as created_at, 'ticket' as source
         FROM tickets
         WHERE related_to_type = 'client' AND related_to_id = ? AND deleted = 0
         ORDER BY updated_at DESC LIMIT 5`,
        [clientId]
      ),
      // Recent shoots
      safeQuery(
        `SELECT id, project_campaign_name as title, shoot_status as status, updated_at as created_at, 'shoot' as source
         FROM shoots
         WHERE client_brand_id = ? AND deleted = 0
         ORDER BY updated_at DESC LIMIT 5`,
        [clientId]
      ),
      // Portal activities
      safeQuery('SELECT * FROM client_portal_activities WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', [clientId]),
      // Projects
      safeQuery('SELECT id, title, status FROM projects WHERE client_id = ? AND deleted = 0 ORDER BY created_at DESC', [clientId]),
      // Portal progress
      safeQuery('SELECT * FROM client_portal_progress WHERE client_id = ? ORDER BY sort_order', [clientId]),
      // Wins
      safeQuery('SELECT * FROM client_portal_wins WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', [clientId]),
      // Pending tasks
      safeQuery(
        `SELECT t.id, t.title, t.deadline as due_date, 'deliverable' as action_type
         FROM tasks t
         INNER JOIN project_tasks pt ON pt.task_id = t.id
         INNER JOIN projects p ON p.id = pt.project_id
         WHERE p.client_id = ? AND t.deleted = 0 AND t.status IN ('to_do','in_progress')
         ORDER BY t.deadline ASC LIMIT 5`,
        [clientId]
      ),
      // Portal next actions
      safeQuery('SELECT * FROM client_portal_next_actions WHERE client_id = ? AND is_completed = 0 ORDER BY due_date ASC LIMIT 5', [clientId]),
      // Portal team
      safeQuery('SELECT * FROM client_portal_team WHERE client_id = ? ORDER BY sort_order', [clientId]),
      // Brand health
      safeQuery('SELECT * FROM client_portal_brand_health WHERE client_id = ?', [clientId]),
      // Approval count
      safeQuery("SELECT COUNT(*) as count FROM client_portal_approvals WHERE client_id = ? AND status = 'pending'", [clientId]),
      // Pending from client
      safeQuery('SELECT * FROM client_portal_pending WHERE client_id = ? AND is_resolved = 0 ORDER BY priority DESC', [clientId]),
      // CRM meetings
      safeQuery(
        `SELECT id, title, CONCAT(meeting_date, ' ', start_time) as scheduled_at, 
                TIMESTAMPDIFF(MINUTE, CONCAT(meeting_date, ' ', start_time), CONCAT(meeting_date, ' ', end_time)) as duration_minutes, 
                meeting_link, 'crm' as source
         FROM meetings
         WHERE client_id = ? AND deleted = 0 AND status = 'scheduled' AND meeting_date >= CURDATE()
         ORDER BY meeting_date ASC, start_time ASC LIMIT 1`,
        [clientId]
      ),
      // Portal meetings
      safeQuery("SELECT * FROM client_portal_meetings WHERE client_id = ? AND status = 'scheduled' AND scheduled_at > NOW() ORDER BY scheduled_at ASC LIMIT 1", [clientId]),
      // Notification count
      safeQuery('SELECT COUNT(*) as count FROM client_portal_notifications WHERE client_id = ? AND is_read = 0', [clientId]),
      // Invoice summary
      safeQuery(
        `SELECT COUNT(*) as total, 
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
                SUM(CASE WHEN status IN ('sent','overdue') THEN 1 ELSE 0 END) as pending
         FROM invoices WHERE lead_id = ? AND deleted = 0`,
        [clientId]
      ),
      // Content calendar access flag
      safeQuery('SELECT content_calendar_access FROM client_portal_users WHERE client_id = ?', [clientId])
    ]);

    const client = clientRows[0] || {};

    // Build activity feed
    const statusIcons = {
      completed: '✅', done: '✅', approved: '✅', paid: '✅',
      in_progress: '🔄', active: '🔄', ongoing: '🔄', to_do: '📋',
      pending: '⏳', scheduled: '📅', sent: '📩',
      cancelled: '❌', overdue: '⚠️',
    };
    const sourceLabels = { task: 'Task', ticket: 'Ticket', shoot: 'Shoot' };

    const allActivities = [...recentTasks, ...recentTickets, ...recentShoots]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 15)
      .map(a => ({
        id: `${a.source}_${a.id}`,
        title: a.title,
        description: `${sourceLabels[a.source]} — ${a.status?.replace(/_/g, ' ') || 'updated'}`,
        icon: statusIcons[a.status] || '⚡',
        created_at: a.created_at,
      }));

    const activities = [...portalActivities, ...allActivities]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    // Progress bars
    const progressFromProjects = projects.map(p => ({
      id: p.id,
      label: p.title,
      percentage: p.status === 'completed' ? 100 : p.status === 'in_progress' ? 50 : p.status === 'open' ? 10 : 0,
      color: p.status === 'completed' ? '#22c55e' : p.status === 'in_progress' ? '#4C2C21' : '#f59e0b',
    }));
    const progress = portalProgress.length > 0 ? portalProgress : progressFromProjects;

    // Next actions
    const nextActions = [...portalNextActions, ...pendingTasks.map(t => ({
      id: `task_${t.id}`, title: t.title, action_type: t.action_type, due_date: t.due_date
    }))].slice(0, 10);

    // Team (fallback to assigned user if no portal team)
    let team = portalTeam;
    if (team.length === 0) {
      const assignedUser = await safeQuery(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, r.name as role_name
         FROM leads l
         JOIN users u ON u.id = l.assigned_to
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE l.id = ?`,
        [clientId]
      );
      if (assignedUser.length > 0) {
        team = assignedUser.map(u => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`,
          role: u.role_name || 'Account Manager',
          avatar_url: u.avatar_url,
          email: u.email,
        }));
      }
    }

    const upcomingMeeting = portalMeetings[0] || crmMeetings[0] || null;

    return res.json({
      client,
      services,
      activities,
      progress,
      wins,
      nextActions,
      team,
      brandHealth: brandHealthRows[0] || null,
      pendingApprovals: approvalCountRows[0]?.count || 0,
      pendingItems,
      upcomingMeeting,
      unreadNotifications: notifCountRows[0]?.count || 0,
      invoiceSummary: invoiceSummary[0] || null,
      projectsCount: projects.length,
      contentCalendarAccess: calendarAccessRows[0]?.content_calendar_access ? true : false,
    });
  } catch (err) {
    console.error('getDashboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/approvals
 * List all approvals for the client
 */
exports.getApprovals = async (req, res) => {
  const clientId = req.clientUser.client_id;
  const { status } = req.query;

  try {
    let where = 'WHERE client_id = ?';
    const params = [clientId];
    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT * FROM client_portal_approvals ${where} ORDER BY created_at DESC`,
      params
    );
    return res.json({ approvals: rows });
  } catch (err) {
    console.error('getApprovals error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/approvals/:id
 * Client responds to an approval (approve, reject, request changes)
 */
exports.respondApproval = async (req, res) => {
  const clientId = req.clientUser.client_id;
  const { id } = req.params;
  const { status, client_comment } = req.body;

  const allowed = ['approved', 'needs_changes'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Status must be approved or needs_changes' });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM client_portal_approvals WHERE id = ? AND client_id = ?',
      [id, clientId]
    );
    if (!existing.length) return res.status(404).json({ message: 'Approval not found' });

    await db.query(
      'UPDATE client_portal_approvals SET status = ?, client_comment = ?, updated_at = NOW() WHERE id = ?',
      [status, client_comment || null, id]
    );

    return res.json({ message: 'Response saved' });
  } catch (err) {
    console.error('respondApproval error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/reports
 * List reports for the client
 */
exports.getReports = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_reports WHERE client_id = ? ORDER BY created_at DESC',
      [clientId]
    );
    return res.json({ reports: rows });
  } catch (err) {
    console.error('getReports error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/notifications
 * Get notifications for the client
 */
exports.getNotifications = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_notifications WHERE client_id = ? ORDER BY created_at DESC LIMIT 50',
      [clientId]
    );
    return res.json({ notifications: rows });
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/client-portal/notifications/read-all
 * Mark all notifications as read
 */
exports.markAllRead = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    await db.query(
      'UPDATE client_portal_notifications SET is_read = 1 WHERE client_id = ?',
      [clientId]
    );
    return res.json({ message: 'All marked as read' });
  } catch (err) {
    console.error('markAllRead error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/support
 * Client submits a support request
 */
exports.createSupportRequest = async (req, res) => {
  const clientId = req.clientUser.client_id;
  const { subject, message, request_type } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required' });
  }

  try {
    await db.query(
      'INSERT INTO client_portal_support (client_id, subject, message, request_type) VALUES (?, ?, ?, ?)',
      [clientId, subject, message, request_type || 'question']
    );
    return res.json({ message: 'Support request submitted' });
  } catch (err) {
    console.error('createSupportRequest error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/support
 * Get support requests for the client
 */
exports.getSupportRequests = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_support WHERE client_id = ? ORDER BY created_at DESC',
      [clientId]
    );
    return res.json({ requests: rows });
  } catch (err) {
    console.error('getSupportRequests error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/roadmap
 * Get client success roadmap
 */
exports.getRoadmap = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_roadmap WHERE client_id = ? ORDER BY month_number',
      [clientId]
    );
    return res.json({ roadmap: rows });
  } catch (err) {
    console.error('getRoadmap error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/ideas
 * Ideas we're exploring for this client
 */
exports.getIdeas = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_ideas WHERE client_id = ? ORDER BY created_at DESC',
      [clientId]
    );
    return res.json({ ideas: rows });
  } catch (err) {
    console.error('getIdeas error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/meetings
 * Get meetings for the client
 */
exports.getMeetings = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM client_portal_meetings WHERE client_id = ? ORDER BY scheduled_at DESC',
      [clientId]
    );
    return res.json({ meetings: rows });
  } catch (err) {
    console.error('getMeetings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/files
 * Get files shared with the client
 */
exports.getFiles = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [files] = await db.query(
      `SELECT cf.id, cf.file_name, cf.file_path, cf.file_size, cf.file_type, cf.folder_id, cf.category, cf.created_at
       FROM client_files cf
       WHERE cf.client_id = ?
       ORDER BY cf.created_at DESC`,
      [clientId]
    );

    const [folders] = await db.query(
      'SELECT * FROM client_folders WHERE client_id = ? ORDER BY name',
      [clientId]
    );

    return res.json({ files, folders });
  } catch (err) {
    console.error('getFiles error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/client-portal/profile
 * Get client profile for display
 */
exports.getProfile = async (req, res) => {
  const clientId = req.clientUser.client_id;
  try {
    const [client] = await db.query(
      'SELECT id, name, business_name, email, phone, website, address, city, state, country FROM leads WHERE id = ?',
      [clientId]
    );
    return res.json({ profile: client[0] || {} });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CRM-SIDE APIs for managing portal data (activities, progress, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/client-portal/activities
 * CRM user adds an activity to client's feed
 */
exports.addActivity = async (req, res) => {
  const { client_id, activity_type, title, description, icon } = req.body;
  if (!client_id || !title) {
    return res.status(400).json({ message: 'client_id and title are required' });
  }
  try {
    await db.query(
      'INSERT INTO client_portal_activities (client_id, activity_type, title, description, icon, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [client_id, activity_type || 'general', title, description || null, icon || null, req.user.id]
    );
    return res.json({ message: 'Activity added' });
  } catch (err) {
    console.error('addActivity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/progress
 * CRM user adds/updates progress bar for client
 */
exports.upsertProgress = async (req, res) => {
  const { client_id, items } = req.body;
  if (!client_id || !Array.isArray(items)) {
    return res.status(400).json({ message: 'client_id and items array required' });
  }
  try {
    // Delete existing and re-insert
    await db.query('DELETE FROM client_portal_progress WHERE client_id = ?', [client_id]);
    for (let i = 0; i < items.length; i++) {
      const { label, percentage, color } = items[i];
      await db.query(
        'INSERT INTO client_portal_progress (client_id, label, percentage, color, sort_order) VALUES (?, ?, ?, ?, ?)',
        [client_id, label, percentage || 0, color || '#6366f1', i]
      );
    }
    return res.json({ message: 'Progress updated' });
  } catch (err) {
    console.error('upsertProgress error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/wins
 * CRM user adds a monthly win
 */
exports.addWin = async (req, res) => {
  const { client_id, title, icon, month } = req.body;
  if (!client_id || !title) {
    return res.status(400).json({ message: 'client_id and title required' });
  }
  try {
    await db.query(
      'INSERT INTO client_portal_wins (client_id, title, icon, month) VALUES (?, ?, ?, ?)',
      [client_id, title, icon || '🏆', month || null]
    );
    return res.json({ message: 'Win added' });
  } catch (err) {
    console.error('addWin error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/approvals
 * CRM user creates an approval request for client
 */
exports.createApproval = async (req, res) => {
  const { client_id, title, description, file_url, file_name, category } = req.body;
  if (!client_id || !title) {
    return res.status(400).json({ message: 'client_id and title required' });
  }
  try {
    await db.query(
      `INSERT INTO client_portal_approvals (client_id, title, description, file_url, file_name, category, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [client_id, title, description || null, file_url || null, file_name || null, category || null, req.user.id]
    );
    // Add notification
    await db.query(
      "INSERT INTO client_portal_notifications (client_id, title, type) VALUES (?, ?, 'approval')",
      [client_id, `New approval: ${title}`]
    );
    return res.json({ message: 'Approval created' });
  } catch (err) {
    console.error('createApproval error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/reports
 * CRM user uploads a report for client
 */
exports.addReport = async (req, res) => {
  const { client_id, title, report_type, file_url, file_name, month } = req.body;
  if (!client_id || !title) {
    return res.status(400).json({ message: 'client_id and title required' });
  }
  try {
    await db.query(
      'INSERT INTO client_portal_reports (client_id, title, report_type, file_url, file_name, month) VALUES (?, ?, ?, ?, ?, ?)',
      [client_id, title, report_type || null, file_url || null, file_name || null, month || null]
    );
    await db.query(
      "INSERT INTO client_portal_notifications (client_id, title, type) VALUES (?, ?, 'report')",
      [client_id, `New report: ${title}`]
    );
    return res.json({ message: 'Report added' });
  } catch (err) {
    console.error('addReport error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/team
 * CRM user manages team members visible to client
 */
exports.upsertTeam = async (req, res) => {
  const { client_id, members } = req.body;
  if (!client_id || !Array.isArray(members)) {
    return res.status(400).json({ message: 'client_id and members array required' });
  }
  try {
    await db.query('DELETE FROM client_portal_team WHERE client_id = ?', [client_id]);
    for (let i = 0; i < members.length; i++) {
      const { user_id, name, role, avatar_url, email } = members[i];
      await db.query(
        'INSERT INTO client_portal_team (client_id, user_id, name, role, avatar_url, email, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [client_id, user_id || null, name, role, avatar_url || null, email || null, i]
      );
    }
    return res.json({ message: 'Team updated' });
  } catch (err) {
    console.error('upsertTeam error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/client-portal/brand-health
 * CRM user updates brand health score
 */
exports.updateBrandHealth = async (req, res) => {
  const { client_id, score, posting_consistency, engagement, seo_health, ad_consistency } = req.body;
  if (!client_id) return res.status(400).json({ message: 'client_id required' });
  try {
    await db.query(
      `INSERT INTO client_portal_brand_health (client_id, score, posting_consistency, engagement, seo_health, ad_consistency)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE score = VALUES(score), posting_consistency = VALUES(posting_consistency),
       engagement = VALUES(engagement), seo_health = VALUES(seo_health), ad_consistency = VALUES(ad_consistency)`,
      [client_id, score || 0, posting_consistency || 0, engagement || 0, seo_health || 0, ad_consistency || 0]
    );
    return res.json({ message: 'Brand health updated' });
  } catch (err) {
    console.error('updateBrandHealth error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
