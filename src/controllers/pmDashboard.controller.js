const db = require('../config/db');

// Helper to ensure follow-up table exists (non-fatal)
let tableChecked = false;
async function ensureTables() {
  if (tableChecked) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS pm_approval_followups (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        client_id INT UNSIGNED NOT NULL,
        plan_id INT UNSIGNED DEFAULT NULL,
        followed_up_by INT UNSIGNED NOT NULL,
        followed_up_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        next_follow_up_date DATE DEFAULT NULL,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_client (client_id),
        INDEX idx_plan (plan_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    tableChecked = true;
  } catch (err) {
    console.error('ensureTables non-fatal notice (pm_approval_followups):', err.message);
  }
}

/**
 * GET /api/pm-dashboard/overview
 * Fetches all 8 sections for the Project Manager Mission Control Dashboard
 */
exports.getOverview = async (req, res) => {
  try {
    await ensureTables();
    const userId = req.user.id;
    const isAdmin = !!req.user.is_admin;
    const { scope, coordinator_id, client_id, department, month_year } = req.query;

    const filterUserId = coordinator_id ? parseInt(coordinator_id, 10) : (scope === 'own' && !isAdmin ? userId : null);

    // ── 1. ACTIVE PROJECTS & PROJECT HEALTH (Uses Social Overview Base) ───────
    let projects = [];
    try {
      let planWhere = 'p.deleted = 0';
      const planParams = [];

      if (filterUserId) {
        planWhere += ' AND (p.created_by = ? OR p.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))';
        planParams.push(filterUserId, filterUserId);
      }

      if (client_id) {
        planWhere += ' AND (p.client_id = ? OR pr.client_id = ?)';
        planParams.push(parseInt(client_id, 10), parseInt(client_id, 10));
      }

      const [rows] = await db.query(
        `SELECT 
           p.id AS plan_id,
           p.project_id,
           p.client_id,
           p.plan_month,
           p.status AS plan_status,
           COALESCE(pr.title, CONCAT('Plan #', p.id)) AS project_name,
           COALESCE(pr.project_type, 'external') AS project_type,
           COALESCE(l.business_name, pr.title, 'Client Project') AS client_name,
           pr.start_date,
           pr.end_date,
           CONCAT(u.first_name, ' ', u.last_name) AS owner_name,
           u.avatar_url AS owner_avatar,
           COALESCE(SUM(CASE WHEN cp.format = 'reel' THEN 1 ELSE 0 END), 0) AS video_count,
           COALESCE(SUM(CASE WHEN cp.format IN ('static_post', 'carousel') THEN 1 ELSE 0 END), 0) AS poster_count,
           COUNT(cp.id) AS total_creatives,
           COALESCE(SUM(CASE WHEN cp.status = 'done' OR cp.slot_status = 'approved' THEN 1 ELSE 0 END), 0) AS done_count,
           COALESCE(SUM(CASE WHEN cp.slot_status = 'pending_approval' THEN 1 ELSE 0 END), 0) AS pending_approval_count,
           COALESCE(SUM(CASE WHEN cp.posting_date < CURDATE() AND (cp.status != 'done' AND cp.slot_status != 'approved') THEN 1 ELSE 0 END), 0) AS overdue_count
         FROM content_calendar_plans p
         LEFT JOIN projects pr ON pr.id = p.project_id
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN users u ON u.id = COALESCE(pr.created_by, p.created_by)
         LEFT JOIN content_calendar_posts cp ON cp.plan_id = p.id
         WHERE ${planWhere}
         GROUP BY p.id
         ORDER BY p.plan_month DESC, COALESCE(pr.title, '') ASC`,
        planParams
      );
      projects = rows;
    } catch (err) {
      console.error('PM Dashboard projects query error:', err.message);
    }

    // Process Project Health
    let onTrackCount = 0;
    let atRiskCount = 0;
    let delayedCount = 0;

    const projectHealthList = projects.map(p => {
      const total = Number(p.total_creatives || 0);
      const approved = Number(p.done_count || 0);
      const progress = total > 0 ? Math.round((approved / total) * 100) : 0;
      const overdue = Number(p.overdue_count || 0);
      const pendingApproval = Number(p.pending_approval_count || 0);

      let health = 'on_track';
      let nextAction = 'Continue scheduled production';
      let currentStage = 'Content Plan';

      const now = new Date();
      const deadline = p.end_date ? new Date(p.end_date) : null;
      const daysToDeadline = deadline ? Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)) : 999;

      if (overdue > 0 || (deadline && daysToDeadline < 0 && progress < 100)) {
        health = 'delayed';
        nextAction = `Clear ${overdue} overdue deliverable(s)`;
        currentStage = 'Delayed Tasks';
        delayedCount++;
      } else if (pendingApproval > 2 || (daysToDeadline <= 7 && progress < 70)) {
        health = 'at_risk';
        nextAction = pendingApproval > 0 ? 'Follow up on pending approvals' : 'Expedite production review';
        currentStage = pendingApproval > 0 ? 'Client Approval' : 'Production';
        atRiskCount++;
      } else {
        health = 'on_track';
        onTrackCount++;
        if (progress === 100) {
          currentStage = 'Completed';
          nextAction = 'Review cycle completion';
        } else if (pendingApproval > 0) {
          currentStage = 'Client Approval';
          nextAction = 'Follow up with client';
        } else {
          currentStage = 'Execution';
          nextAction = 'Monitor delivery milestones';
        }
      }

      return {
        id: p.plan_id ? `plan_${p.plan_id}` : (p.project_id ? `proj_${p.project_id}` : Math.random()),
        plan_id: p.plan_id,
        project_id: p.project_id,
        project_name: p.project_name,
        client_name: p.client_name || 'Internal',
        client_id: p.client_id,
        progress,
        deliverables_approved: approved,
        deliverables_total: total,
        deliverables_ratio: `${approved}/${total}`,
        health,
        current_stage: currentStage,
        next_action: nextAction,
        deadline: p.end_date,
        owner: p.owner_name || 'Project Manager',
        owner_avatar: p.owner_avatar,
      };
    });

    // ── 2. TODAY'S ACTIONS (HIGHEST PRIORITY) ────────────────────────────────
    let tasks = [];
    let dueTodayCount = 0;
    try {
      let taskWhere = 't.deleted = 0 AND (t.status NOT IN ("completed", "done") OR t.status IS NULL)';
      const taskParams = [];

      if (filterUserId) {
        taskWhere += ' AND (t.assigned_to = ? OR t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
        taskParams.push(filterUserId, filterUserId, filterUserId);
      }

      const [taskRows] = await db.query(
        `SELECT 
           t.id,
           t.task_id_code,
           t.title AS task_title,
           t.priority,
           t.status,
           t.deadline,
           t.assigned_to,
           t.created_by,
           t.created_at,
           CONCAT(u.first_name, ' ', u.last_name) AS owner_name,
           u.avatar_url AS owner_avatar,
           (SELECT p2.title FROM project_tasks pt2 JOIN projects p2 ON p2.id = pt2.project_id WHERE pt2.task_id = t.id LIMIT 1) AS project_name,
           (SELECT l2.business_name FROM project_tasks pt2 JOIN projects p2 ON p2.id = pt2.project_id LEFT JOIN leads l2 ON l2.id = p2.client_id WHERE pt2.task_id = t.id LIMIT 1) AS client_name,
           CASE WHEN t.deadline < CURDATE() THEN 1 ELSE 0 END AS is_overdue,
           CASE WHEN t.deadline = CURDATE() THEN 1 ELSE 0 END AS is_due_today
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         WHERE ${taskWhere}
         ORDER BY 
           CASE WHEN t.deadline < CURDATE() THEN 0 ELSE 1 END ASC,
           CASE t.priority 
             WHEN 'critical' THEN 1 
             WHEN 'high' THEN 2 
             WHEN 'medium' THEN 3 
             WHEN 'low' THEN 4 
             ELSE 5 
           END ASC,
           t.deadline ASC
         LIMIT 50`,
        taskParams
      );
      tasks = taskRows;

      const [dueTodayRows] = await db.query(
        `SELECT COUNT(*) AS count FROM tasks t WHERE t.deleted = 0 AND (t.status NOT IN ('completed', 'done') OR t.status IS NULL) AND t.deadline = CURDATE()`
      );
      dueTodayCount = dueTodayRows[0]?.count || 0;
    } catch (err) {
      console.error('PM Dashboard tasks query error:', err.message);
    }

    // ── 3. DELIVERY PIPELINE (9 STAGES) ────────────────────────────────────
    const pipelineStages = [
      { key: 'strategy', label: 'Strategy', count: 0, delayed: 0 },
      { key: 'content_plan', label: 'Content Plan', count: 0, delayed: 0 },
      { key: 'script', label: 'Script', count: 0, delayed: 0 },
      { key: 'shoot', label: 'Shoot', count: 0, delayed: 0 },
      { key: 'edit', label: 'Edit', count: 0, delayed: 0 },
      { key: 'internal_qc', label: 'Internal QC', count: 0, delayed: 0 },
      { key: 'client_approval', label: 'Client Approval', count: 0, delayed: 0 },
      { key: 'schedule', label: 'Schedule', count: 0, delayed: 0 },
      { key: 'published', label: 'Published', count: 0, delayed: 0 },
    ];

    try {
      const [slotStats] = await db.query(`
        SELECT 
          format,
          slot_status,
          status,
          COUNT(*) AS count,
          SUM(CASE WHEN posting_date < CURDATE() AND (slot_status != 'approved' AND status != 'done') THEN 1 ELSE 0 END) AS delayed_count
        FROM content_calendar_posts
        GROUP BY format, slot_status, status
      `);

      slotStats.forEach(r => {
        const c = parseInt(r.count, 10) || 0;
        const d = parseInt(r.delayed_count, 10) || 0;
        if (r.slot_status === 'approved' || r.status === 'done') {
          pipelineStages[8].count += c; // Published
        } else if (r.slot_status === 'pending_approval') {
          pipelineStages[6].count += c; // Client Approval
          pipelineStages[6].delayed += d;
        } else if (r.slot_status === 'submitted') {
          pipelineStages[5].count += c; // Internal QC
          pipelineStages[5].delayed += d;
        } else if (r.slot_status === 'picked_up' || r.status === 'in_progress') {
          if (r.format === 'reel') {
            pipelineStages[4].count += c; // Edit
            pipelineStages[4].delayed += d;
          } else {
            pipelineStages[2].count += c; // Script/Design
            pipelineStages[2].delayed += d;
          }
        } else {
          pipelineStages[1].count += c; // Content Plan
          pipelineStages[1].delayed += d;
        }
      });

      const [shootCountRow] = await db.query(
        `SELECT COUNT(*) AS count, SUM(CASE WHEN shoot_date < CURDATE() AND status != 'approved' THEN 1 ELSE 0 END) AS delayed 
         FROM shoots WHERE deleted = 0 AND shoot_date >= CURDATE() - INTERVAL 7 DAY`
      );
      pipelineStages[3].count = shootCountRow[0]?.count || 0; // Shoot
      pipelineStages[3].delayed = shootCountRow[0]?.delayed || 0;
    } catch (err) {
      console.error('PM Dashboard pipeline query error:', err.message);
    }

    // ── 4. TEAM WORKLOAD ───────────────────────────────────────────────────
    let teamWorkload = [];
    try {
      const [workloadRows] = await db.query(`
        SELECT 
          u.id AS user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS name,
          u.avatar_url AS avatar,
          COALESCE(r.name, 'Member') AS role_name,
          COALESCE(u.department, 'Operations') AS department,
          COUNT(t.id) AS assigned_count,
          SUM(CASE WHEN t.status IN ('completed', 'done') THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN t.status NOT IN ('completed', 'done') AND t.status IS NOT NULL THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN t.status NOT IN ('completed', 'done') AND t.deadline < CURDATE() THEN 1 ELSE 0 END) AS overdue_count
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN tasks t ON t.assigned_to = u.id AND t.deleted = 0
        WHERE u.deleted = 0 AND u.is_active = 1
        GROUP BY u.id
        ORDER BY pending_count DESC, overdue_count DESC
      `);

      teamWorkload = workloadRows.map(w => {
        const capacity = 10;
        const pending = parseInt(w.pending_count, 10) || 0;
        const workloadPct = Math.min(100, Math.round((pending / capacity) * 100));
        return {
          ...w,
          workload_pct: workloadPct,
        };
      });
    } catch (err) {
      console.error('PM Dashboard workload query error:', err.message);
    }

    // ── 5. CLIENT APPROVAL CONTROL ─────────────────────────────────────────
    let clientApprovals = [];
    let totalPendingApprovalSlots = 0;
    try {
      const [approvalRows] = await db.query(`
        SELECT 
          l.id AS client_id,
          l.business_name AS client_name,
          p.id AS plan_id,
          p.plan_month,
          COUNT(cp.id) AS total_slots,
          SUM(CASE WHEN cp.slot_status = 'pending_approval' THEN 1 ELSE 0 END) AS pending_slots,
          SUM(CASE WHEN cp.slot_status = 'approved' OR cp.status = 'done' THEN 1 ELSE 0 END) AS approved_slots,
          COALESCE(DATEDIFF(CURDATE(), MIN(CASE WHEN cp.slot_status = 'pending_approval' THEN cp.submitted_at ELSE NULL END)), 0) AS oldest_pending_days
        FROM content_calendar_plans p
        JOIN leads l ON l.id = p.client_id
        LEFT JOIN content_calendar_posts cp ON cp.plan_id = p.id
        WHERE p.deleted = 0
        GROUP BY l.id, p.id
        ORDER BY pending_slots DESC, oldest_pending_days DESC
      `);

      clientApprovals = approvalRows.map(r => ({
        client_id: r.client_id,
        client_name: r.client_name,
        plan_id: r.plan_id,
        pending_slots: parseInt(r.pending_slots, 10) || 0,
        approved_ratio: `${r.approved_slots || 0}/${r.total_slots || 0}`,
        oldest_pending_days: r.oldest_pending_days > 0 ? `${r.oldest_pending_days} days` : 'Today',
        status: 'Waiting for Client',
      }));

      totalPendingApprovalSlots = clientApprovals.reduce((acc, c) => acc + c.pending_slots, 0);
    } catch (err) {
      console.error('PM Dashboard approvals query error:', err.message);
    }

    // ── 6. UPCOMING SHOOTS ────────────────────────────────────────────────
    let upcomingShoots = [];
    try {
      let shootWhere = 's.deleted = 0 AND s.shoot_date >= CURDATE()';
      const shootParams = [];

      if (filterUserId) {
        shootWhere += ' AND (s.shoot_manager_id = ? OR s.created_by = ?)';
        shootParams.push(filterUserId, filterUserId);
      }

      const [shoots] = await db.query(
        `SELECT 
           s.id,
           s.shoot_id_code,
           s.project_campaign_name,
           s.shoot_date,
           s.start_time,
           s.end_time,
           s.location_type,
           s.exact_address,
           s.city,
           s.equipment_used,
           s.status,
           l.business_name AS client_name,
           CONCAT(u.first_name, ' ', u.last_name) AS shoot_manager_name,
           u.avatar_url AS shoot_manager_avatar
         FROM shoots s
         LEFT JOIN leads l ON l.id = s.client_brand_id
         LEFT JOIN users u ON u.id = s.shoot_manager_id
         WHERE ${shootWhere}
         ORDER BY s.shoot_date ASC, s.start_time ASC
         LIMIT 20`,
        shootParams
      );

      upcomingShoots = shoots.map(s => {
        const hasLocation = !!(s.exact_address || s.city || s.location_type);
        const hasManager = !!s.shoot_manager_name;
        const hasEquipment = !!s.equipment_used;
        const isReady = hasLocation && hasManager;

        return {
          id: s.id,
          shoot_code: s.shoot_id_code || `SHT-${s.id}`,
          client_name: s.client_name || s.project_campaign_name,
          shoot_date: s.shoot_date,
          shoot_time: `${s.start_time?.slice(0, 5) || ''} - ${s.end_time?.slice(0, 5) || ''}`,
          duration: '4–5 hrs',
          scripts_status: '8/8 Ready',
          location: hasLocation ? (s.city || 'Confirmed') : 'Pending',
          team: hasManager ? s.shoot_manager_name : 'Unassigned',
          equipment: hasEquipment ? 'Ready' : 'Standard Kit',
          shot_list: 'Ready',
          readiness: isReady ? 'Ready' : 'Not Ready',
        };
      });
    } catch (err) {
      console.error('PM Dashboard shoots query error:', err.message);
    }

    // ── 7. ISSUES & ESCALATIONS ───────────────────────────────────────────
    let tickets = [];
    try {
      let ticketWhere = 't.deleted = 0 AND t.status IN ("open", "in_progress")';
      const ticketParams = [];

      if (filterUserId) {
        ticketWhere += ' AND (t.assigned_to = ? OR t.reported_by = ?)';
        ticketParams.push(filterUserId, filterUserId);
      }

      const [ticketRows] = await db.query(
        `SELECT 
           t.id,
           t.ticket_id_code,
           t.title AS issue_title,
           t.priority,
           t.status,
           t.due_date,
           t.created_at,
           CONCAT(u.first_name, ' ', u.last_name) AS owner_name,
           u.avatar_url AS owner_avatar,
           COALESCE(pr.title, l.business_name, 'Operational') AS client_project_name,
           CASE 
             WHEN t.priority = 'critical' THEN 'Founder'
             WHEN t.priority = 'high' THEN 'PM'
             ELSE 'Team Lead'
           END AS escalation_level
         FROM tickets t
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN projects pr ON pr.id = t.project_id
         LEFT JOIN leads l ON l.id = t.related_to_id AND t.related_to_type = 'client'
         WHERE ${ticketWhere}
         ORDER BY 
           CASE t.priority 
             WHEN 'critical' THEN 1 
             WHEN 'high' THEN 2 
             WHEN 'medium' THEN 3 
             WHEN 'low' THEN 4 
             ELSE 5 
           END ASC,
           t.created_at DESC
         LIMIT 25`,
        ticketParams
      );
      tickets = ticketRows;
    } catch (err) {
      console.error('PM Dashboard tickets query error:', err.message);
    }

    // ── 8. PROJECT COORDINATORS / MANAGERS LIST (FOR DROPDOWN) ─────────────
    let coordinators = [];
    try {
      const [coordRows] = await db.query(`
        SELECT DISTINCT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, u.avatar_url AS avatar
        FROM users u
        WHERE u.deleted = 0 AND u.is_active = 1
        ORDER BY u.first_name ASC
      `);
      coordinators = coordRows;
    } catch (err) {
      console.error('PM Dashboard coordinators query error:', err.message);
    }

    // ── 9. TOP KPI CARDS AGGREGATION ──────────────────────────────────────
    const kpis = {
      active_projects: projects.length,
      on_track: onTrackCount,
      at_risk: atRiskCount,
      delayed: delayedCount,
      due_today: dueTodayCount,
      pending_client_approval: totalPendingApprovalSlots,
      open_issues: tickets.length,
      upcoming_shoots: upcomingShoots.length,
    };

    return res.json({
      kpis,
      today_actions: tasks,
      project_health: projectHealthList,
      delivery_pipeline: pipelineStages,
      team_workload: teamWorkload,
      client_approvals: clientApprovals,
      upcoming_shoots: upcomingShoots,
      issues_escalations: tickets,
      coordinators,
    });
  } catch (err) {
    console.error('PM Dashboard getOverview fatal error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};

/**
 * PUT /api/pm-dashboard/tasks/:id/status
 * Inline quick update of task status by PM
 */
exports.updateTaskStatus = async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const userId = req.user.id;

    if (!['to_do', 'in_progress', 'review', 'completed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    await db.query(
      'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
      [status, taskId]
    );

    res.emitSocket('task:status_changed', { task_id: taskId, status, changed_by: userId });
    return res.json({ message: 'Task status updated successfully', task_id: taskId, status });
  } catch (err) {
    console.error('Update task status error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};

/**
 * POST /api/pm-dashboard/client-followup
 * PM logs a client follow-up on pending approvals
 */
exports.logClientFollowup = async (req, res) => {
  try {
    await ensureTables();
    const { client_id, plan_id, notes, next_follow_up_date } = req.body;
    const userId = req.user.id;

    if (!client_id) {
      return res.status(400).json({ message: 'client_id is required' });
    }

    await db.query(
      `INSERT INTO pm_approval_followups (client_id, plan_id, followed_up_by, notes, next_follow_up_date)
       VALUES (?, ?, ?, ?, ?)`,
      [client_id, plan_id || null, userId, notes || '', next_follow_up_date || null]
    );

    return res.json({ message: 'Follow-up logged successfully' });
  } catch (err) {
    console.error('Log client follow-up error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
