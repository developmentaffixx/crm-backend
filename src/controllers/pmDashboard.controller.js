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

    // ── 9. SLOT-LEVEL KPIs (content_calendar_posts) ───────────────────────
    // These five drive the redesigned KPI cards. All are scoped to the same
    // plans the dashboard already resolved above (respects coordinator/own scope).
    let slotKpis = { due_today: 0, delayed: 0, pending_approval: 0, rejected: 0 };
    try {
      // Reuse the scoped plan ids from the projects query so the counts honour
      // the coordinator / own-scope filter. If no plans matched, counts stay 0.
      const scopedPlanIds = projects.map(p => p.plan_id).filter(Boolean);

      if (scopedPlanIds.length > 0) {
        const [slotRows] = await db.query(
          `SELECT
             SUM(CASE WHEN cp.posting_date = CURDATE()
                       AND cp.slot_status NOT IN ('approved','completed')
                      THEN 1 ELSE 0 END) AS due_today,
             SUM(CASE WHEN cp.reschedule_reason IS NOT NULL AND cp.reschedule_reason <> ''
                       AND cp.slot_status NOT IN ('approved','completed')
                      THEN 1 ELSE 0 END) AS delayed,
             SUM(CASE WHEN cp.slot_status IN ('submitted','smm_approved') THEN 1 ELSE 0 END) AS pending_approval,
             SUM(CASE WHEN cp.slot_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
           FROM content_calendar_posts cp
           WHERE cp.plan_id IN (?)`,
          [scopedPlanIds]
        );
        slotKpis = {
          due_today: parseInt(slotRows[0]?.due_today, 10) || 0,
          delayed: parseInt(slotRows[0]?.delayed, 10) || 0,
          pending_approval: parseInt(slotRows[0]?.pending_approval, 10) || 0,
          rejected: parseInt(slotRows[0]?.rejected, 10) || 0,
        };
      }
    } catch (err) {
      // reschedule_reason column may not exist yet — retry without it so the
      // other counts still return instead of zeroing everything.
      console.error('PM Dashboard slot KPI query error:', err.message);
      try {
        const scopedPlanIds = projects.map(p => p.plan_id).filter(Boolean);
        if (scopedPlanIds.length > 0) {
          const [slotRows] = await db.query(
            `SELECT
               SUM(CASE WHEN cp.posting_date = CURDATE()
                         AND cp.slot_status NOT IN ('approved','completed')
                        THEN 1 ELSE 0 END) AS due_today,
               SUM(CASE WHEN cp.slot_status IN ('submitted','smm_approved') THEN 1 ELSE 0 END) AS pending_approval,
               SUM(CASE WHEN cp.slot_status = 'rejected' THEN 1 ELSE 0 END) AS rejected
             FROM content_calendar_posts cp
             WHERE cp.plan_id IN (?)`,
            [scopedPlanIds]
          );
          slotKpis = {
            due_today: parseInt(slotRows[0]?.due_today, 10) || 0,
            delayed: 0,
            pending_approval: parseInt(slotRows[0]?.pending_approval, 10) || 0,
            rejected: parseInt(slotRows[0]?.rejected, 10) || 0,
          };
        }
      } catch (e2) {
        console.error('PM Dashboard slot KPI fallback error:', e2.message);
      }
    }

    // ── 10. TOP KPI CARDS AGGREGATION ─────────────────────────────────────
    const kpis = {
      // Card 1: Active content plans / projects
      active_projects: projects.length,
      on_track: onTrackCount, // retained for Project Health section usage

      // Cards 2–5: slot-level KPIs
      due_today: slotKpis.due_today,                 // posts due today, not yet posted
      delayed: slotKpis.delayed,                     // rescheduled posts still pending
      pending_client_approval: slotKpis.pending_approval, // submitted / smm_approved
      rejected: slotKpis.rejected,                   // sent back for rework

      // retained for other dashboard sections (not shown as top cards anymore)
      at_risk: atRiskCount,
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

/**
 * GET /api/pm-dashboard/sm-ops
 * Returns all 7 SM Ops sections for the PC/PM dashboard:
 *   1. approval_queue   — slots awaiting PC/PM final approval (submitted / smm_approved)
 *   2. delayed_slots    — slots with a reschedule reason, still pending
 *   3. rejected_slots   — slots currently in 'rejected' status
 *   4. upcoming_shoots  — real shoot readiness from the standalone shoots table
 *   5. ad_campaigns     — active / pending ad campaigns + whether a report is filed
 *   6. daily_updates    — today's daily journal submissions + who hasn't filed
 *   7. plan_progress    — per-plan slot progress across posts + shoots + ads
 *
 * Scope: honours the same coordinator_id / scope filters as /overview.
 */
exports.getSmOps = async (req, res) => {
  try {
    const userId   = req.user.id;
    const isAdmin  = !!req.user.is_admin;
    const { scope, coordinator_id } = req.query;

    const filterUserId = coordinator_id
      ? parseInt(coordinator_id, 10)
      : (scope === 'own' && !isAdmin ? userId : null);

    // ── Resolve scoped plan IDs (same logic as getOverview) ─────────────────
    let planIds = [];
    let planRows = [];
    try {
      let planWhere = 'p.deleted = 0';
      const planParams = [];
      if (filterUserId) {
        planWhere += ' AND (p.created_by = ? OR p.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))';
        planParams.push(filterUserId, filterUserId);
      }
      const [rows] = await db.query(
        `SELECT p.id, p.project_id, p.client_id, p.plan_month,
                COALESCE(l.business_name, pr.title, 'Client Project') AS client_name,
                COALESCE(pr.title, CONCAT('Plan #', p.id)) AS project_name
         FROM content_calendar_plans p
         LEFT JOIN projects pr ON pr.id = p.project_id
         LEFT JOIN leads l     ON l.id  = p.client_id
         WHERE ${planWhere}
         ORDER BY p.plan_month DESC`,
        planParams
      );
      planRows = rows;
      planIds  = rows.map(r => r.id);
    } catch (err) {
      console.error('getSmOps plan query error:', err.message);
    }

    // Helper: build a plan lookup map { planId -> { client_name, project_name } }
    const planMap = {};
    planRows.forEach(p => { planMap[p.id] = { client_name: p.client_name, project_name: p.project_name, plan_month: p.plan_month }; });

    if (planIds.length === 0) {
      return res.json({
        approval_queue: [], delayed_slots: [], rejected_slots: [],
        upcoming_shoots: [], ad_campaigns: [], daily_updates: { submitted: [], not_submitted: [], summary: {} },
        plan_progress: [],
      });
    }

    // ── 1. APPROVAL QUEUE (submitted + smm_approved across all 3 types) ─────
    let approvalQueue = [];
    try {
      // Posts
      const [posts] = await db.query(
        `SELECT cp.id, 'post' AS item_type, cp.plan_id,
                cp.slot_status, cp.platform, cp.format, cp.topic AS title,
                cp.posting_date AS scheduled_date,
                cp.submitted_at, cp.smm_approved_at,
                cp.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name,
                u.avatar_url AS owner_avatar
         FROM content_calendar_posts cp
         LEFT JOIN users u ON u.id = cp.assigned_to
         WHERE cp.plan_id IN (?) AND cp.slot_status IN ('submitted','smm_approved')
         ORDER BY cp.submitted_at ASC`,
        [planIds]
      );

      // Shoots
      const [shoots] = await db.query(
        `SELECT cs.id, 'shoot' AS item_type, cs.plan_id,
                cs.slot_status, NULL AS platform, NULL AS format,
                COALESCE(cs.description,'Shoot') AS title,
                cs.shoot_date AS scheduled_date,
                cs.submitted_at, cs.smm_approved_at,
                cs.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name,
                u.avatar_url AS owner_avatar
         FROM content_calendar_shoots cs
         LEFT JOIN users u ON u.id = cs.assigned_to
         WHERE cs.plan_id IN (?) AND cs.slot_status IN ('submitted','smm_approved')
         ORDER BY cs.submitted_at ASC`,
        [planIds]
      );

      // Ads
      const [ads] = await db.query(
        `SELECT ca.id, 'ad' AS item_type, ca.plan_id,
                ca.slot_status, ca.platform, NULL AS format,
                COALESCE(ca.creative_name, ca.ad_no, 'Ad Slot') AS title,
                ca.start_date AS scheduled_date,
                ca.submitted_at, ca.smm_approved_at,
                ca.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name,
                u.avatar_url AS owner_avatar
         FROM content_calendar_ads ca
         LEFT JOIN users u ON u.id = ca.assigned_to
         WHERE ca.plan_id IN (?) AND ca.slot_status IN ('submitted','smm_approved')
         ORDER BY ca.submitted_at ASC`,
        [planIds]
      );

      const all = [...posts, ...shoots, ...ads].map(r => {
        const plan = planMap[r.plan_id] || {};
        const waitingDays = r.submitted_at
          ? Math.floor((Date.now() - new Date(r.submitted_at)) / 86400000)
          : 0;
        return { ...r, client_name: plan.client_name, project_name: plan.project_name, waiting_days: waitingDays };
      });
      // Sort: longest-waiting first
      all.sort((a, b) => b.waiting_days - a.waiting_days);
      approvalQueue = all;
    } catch (err) {
      console.error('getSmOps approvalQueue error:', err.message);
    }

    // ── 2. DELAYED / RESCHEDULED SLOTS ──────────────────────────────────────
    let delayedSlots = [];
    try {
      const [posts] = await db.query(
        `SELECT cp.id, 'post' AS item_type, cp.plan_id,
                cp.platform, cp.format, cp.topic AS title,
                cp.posting_date AS current_date_val,
                cp.reschedule_reason,
                cp.slot_status,
                cp.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name
         FROM content_calendar_posts cp
         LEFT JOIN users u ON u.id = cp.assigned_to
         WHERE cp.plan_id IN (?)
           AND cp.reschedule_reason IS NOT NULL AND cp.reschedule_reason <> ''
           AND cp.slot_status NOT IN ('approved','completed')`,
        [planIds]
      );
      const [shoots] = await db.query(
        `SELECT cs.id, 'shoot' AS item_type, cs.plan_id,
                NULL AS platform, NULL AS format,
                COALESCE(cs.description,'Shoot') AS title,
                cs.shoot_date AS current_date_val,
                cs.reschedule_reason,
                cs.slot_status,
                cs.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name
         FROM content_calendar_shoots cs
         LEFT JOIN users u ON u.id = cs.assigned_to
         WHERE cs.plan_id IN (?)
           AND cs.reschedule_reason IS NOT NULL AND cs.reschedule_reason <> ''
           AND cs.slot_status NOT IN ('approved','completed')`,
        [planIds]
      );
      const [ads] = await db.query(
        `SELECT ca.id, 'ad' AS item_type, ca.plan_id,
                ca.platform, NULL AS format,
                COALESCE(ca.creative_name, ca.ad_no, 'Ad Slot') AS title,
                ca.start_date AS current_date_val,
                ca.reschedule_reason,
                ca.slot_status,
                ca.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name
         FROM content_calendar_ads ca
         LEFT JOIN users u ON u.id = ca.assigned_to
         WHERE ca.plan_id IN (?)
           AND ca.reschedule_reason IS NOT NULL AND ca.reschedule_reason <> ''
           AND ca.slot_status NOT IN ('approved','completed')`,
        [planIds]
      );

      // Fetch most-recent reschedule history for each item so we get old → new date
      const allDelayed = [...posts, ...shoots, ...ads];
      if (allDelayed.length > 0) {
        const histKeys = allDelayed.map(r => `('${r.item_type}', ${r.id})`).join(',');
        const [hist] = await db.query(
          `SELECT h.item_type, h.item_id, h.old_date, h.new_date, h.reason,
                  h.created_at,
                  CONCAT(u.first_name,' ',u.last_name) AS rescheduled_by_name
           FROM content_calendar_reschedule_history h
           LEFT JOIN users u ON u.id = h.rescheduled_by
           WHERE (h.item_type, h.item_id) IN (${histKeys})
           ORDER BY h.created_at DESC`
        ).catch(() => [[]]);

        // Keep only the most recent reschedule per item
        const histMap = {};
        hist.forEach(h => {
          const key = `${h.item_type}_${h.item_id}`;
          if (!histMap[key]) histMap[key] = h;
        });

        delayedSlots = allDelayed.map(r => {
          const plan = planMap[r.plan_id] || {};
          const h = histMap[`${r.item_type}_${r.id}`];
          return {
            ...r,
            client_name: plan.client_name,
            project_name: plan.project_name,
            old_date: h?.old_date || null,
            new_date: h?.new_date || null,
            rescheduled_by_name: h?.rescheduled_by_name || null,
            rescheduled_at: h?.created_at || null,
          };
        });
      }
    } catch (err) {
      console.error('getSmOps delayedSlots error:', err.message);
    }

    // ── 3. REJECTED / REWORK SLOTS ──────────────────────────────────────────
    let rejectedSlots = [];
    try {
      const [posts] = await db.query(
        `SELECT cp.id, 'post' AS item_type, cp.plan_id,
                cp.platform, cp.format, cp.topic AS title,
                cp.posting_date AS scheduled_date,
                cp.rejection_reason, cp.slot_status,
                cp.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name,
                u.avatar_url AS owner_avatar
         FROM content_calendar_posts cp
         LEFT JOIN users u ON u.id = cp.assigned_to
         WHERE cp.plan_id IN (?) AND cp.slot_status = 'rejected'`,
        [planIds]
      );
      const [shoots] = await db.query(
        `SELECT cs.id, 'shoot' AS item_type, cs.plan_id,
                NULL AS platform, NULL AS format,
                COALESCE(cs.description,'Shoot') AS title,
                cs.shoot_date AS scheduled_date,
                cs.rejection_reason, cs.slot_status,
                cs.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name,
                u.avatar_url AS owner_avatar
         FROM content_calendar_shoots cs
         LEFT JOIN users u ON u.id = cs.assigned_to
         WHERE cs.plan_id IN (?) AND cs.slot_status = 'rejected'`,
        [planIds]
      );
      const [ads] = await db.query(
        `SELECT ca.id, 'ad' AS item_type, ca.plan_id,
                ca.platform, NULL AS format,
                COALESCE(ca.creative_name, ca.ad_no,'Ad Slot') AS title,
                ca.start_date AS scheduled_date,
                ca.rejection_reason, ca.slot_status,
                ca.assigned_to,
                CONCAT(u.first_name,' ',u.last_name) AS owner_name,
                u.avatar_url AS owner_avatar
         FROM content_calendar_ads ca
         LEFT JOIN users u ON u.id = ca.assigned_to
         WHERE ca.plan_id IN (?) AND ca.slot_status = 'rejected'`,
        [planIds]
      );

      rejectedSlots = [...posts, ...shoots, ...ads].map(r => {
        const plan = planMap[r.plan_id] || {};
        return { ...r, client_name: plan.client_name, project_name: plan.project_name };
      });
    } catch (err) {
      console.error('getSmOps rejectedSlots error:', err.message);
    }

    // ── 4. UPCOMING SHOOTS (real readiness, standalone shoots table) ─────────
    let upcomingShoots = [];
    try {
      let shootWhere = 's.deleted = 0 AND s.shoot_date >= CURDATE() AND s.status NOT IN (\'completed\')';
      const shootParams = [];
      if (filterUserId) {
        shootWhere += ' AND (s.shoot_manager_id = ? OR s.created_by = ?)';
        shootParams.push(filterUserId, filterUserId);
      }
      const [rows] = await db.query(
        `SELECT s.id, s.shoot_id_code, s.project_campaign_name,
                s.shoot_date, s.reporting_time, s.start_time,
                s.location_type, s.exact_address, s.city,
                s.equipment_used, s.status,
                s.photographers, s.videographers,
                s.shoot_manager_id,
                l.business_name AS client_name,
                CONCAT(um.first_name,' ',um.last_name) AS shoot_manager_name,
                um.avatar_url AS shoot_manager_avatar
         FROM shoots s
         LEFT JOIN leads l  ON l.id  = s.client_brand_id
         LEFT JOIN users um ON um.id = s.shoot_manager_id
         WHERE ${shootWhere}
         ORDER BY s.shoot_date ASC, s.reporting_time ASC
         LIMIT 25`,
        shootParams
      );

      upcomingShoots = rows.map(s => {
        const hasManager    = !!s.shoot_manager_name;
        const hasLocation   = !!(s.exact_address || s.city || s.location_type);
        const hasEquipment  = !!s.equipment_used;
        let photographers   = [];
        let videographers   = [];
        try { photographers = s.photographers ? JSON.parse(s.photographers) : []; } catch { /* */ }
        try { videographers = s.videographers ? JSON.parse(s.videographers) : []; } catch { /* */ }
        const hasCrew       = hasManager || photographers.length > 0 || videographers.length > 0;

        let readiness = 'ready';
        const missing = [];
        if (!hasCrew)     { readiness = 'not_ready'; missing.push('Crew'); }
        if (!hasLocation) { readiness = 'not_ready'; missing.push('Location'); }
        if (!hasEquipment && readiness !== 'not_ready') readiness = 'partial';

        return {
          id: s.id,
          shoot_code: s.shoot_id_code || `SHT-${s.id}`,
          client_name: s.client_name || s.project_campaign_name,
          campaign_name: s.project_campaign_name,
          shoot_date: s.shoot_date,
          shoot_time: (s.reporting_time || s.start_time || ''),
          location: s.city || s.exact_address || s.location_type || null,
          shoot_manager: s.shoot_manager_name || null,
          shoot_manager_avatar: s.shoot_manager_avatar || null,
          has_equipment: hasEquipment,
          crew_count: photographers.length + videographers.length + (hasManager ? 1 : 0),
          status: s.status,
          readiness,
          missing_items: missing,
        };
      });
    } catch (err) {
      console.error('getSmOps upcomingShoots error:', err.message);
    }

    // ── 5. AD CAMPAIGNS ──────────────────────────────────────────────────────
    let adCampaigns = [];
    try {
      let adWhere = 'ac.deleted = 0 AND ac.status NOT IN (\'completed\',\'rejected\')';
      const adParams = [];
      if (filterUserId) {
        adWhere += ' AND (ac.created_by = ? OR ac.assigned_to = ? OR ac.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))';
        adParams.push(filterUserId, filterUserId, filterUserId);
      }
      const [rows] = await db.query(
        `SELECT ac.id, ac.campaign_id_code, ac.campaign_name,
                ac.platform, ac.objective, ac.budget,
                ac.start_date, ac.end_date,
                ac.status, ac.notes,
                ac.assigned_to,
                p.title AS project_name,
                l.business_name AS client_name,
                CONCAT(ua.first_name,' ',ua.last_name) AS assigned_to_name,
                acr.id AS report_id,
                acr.amount_spent,
                acr.reach, acr.impressions, acr.clicks
         FROM ad_campaigns ac
         LEFT JOIN projects p   ON p.id  = ac.project_id
         LEFT JOIN leads l      ON l.id  = p.client_id
         LEFT JOIN users ua     ON ua.id = ac.assigned_to
         LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
         WHERE ${adWhere}
         ORDER BY ac.created_at DESC
         LIMIT 30`,
        adParams
      );
      adCampaigns = rows.map(r => ({
        ...r,
        has_report: !!r.report_id,
        days_running: r.start_date
          ? Math.floor((Date.now() - new Date(r.start_date)) / 86400000)
          : null,
      }));
    } catch (err) {
      console.error('getSmOps adCampaigns error:', err.message);
    }

    // ── 6. DAILY UPDATES ─────────────────────────────────────────────────────
    let dailyUpdates = { submitted: [], not_submitted: [], summary: {} };
    try {
      const today = new Date().toISOString().split('T')[0];

      // Who are the SM Ops team members?
      let memberIds = [];
      try {
        const [mRows] = await db.query(
          `SELECT DISTINCT u.id
           FROM users u
           JOIN role_submenu_permissions rsp
             ON rsp.role_id = u.role_id AND rsp.module = 'creative_hub' AND rsp.can_access >= 1
           WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0`
        );
        memberIds = mRows.map(r => r.id);
      } catch (_e) { /* table may not exist */ }

      // Fallback to legacy table
      if (memberIds.length === 0) {
        try {
          const [mRows] = await db.query(
            `SELECT DISTINCT u.id FROM users u
             JOIN role_social_permissions rsp ON rsp.role_id = u.role_id
             WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0
               AND (rsp.content_calendar >= 1 OR rsp.content_writing >= 1 OR rsp.shoot_planning >= 1 OR rsp.ads_planning >= 1 OR rsp.daily_journal >= 1)`
          );
          memberIds = mRows.map(r => r.id);
        } catch (_e2) { /* ignore */ }
      }

      if (memberIds.length > 0) {
        // Who submitted today?
        const [submitted] = await db.query(
          `SELECT dj.id, dj.project_id, dj.submitted_by,
                  dj.health_status, dj.escalation_required, dj.escalation_details,
                  dj.client_communication,
                  p.title AS project_name,
                  CONCAT(u.first_name,' ',u.last_name) AS member_name,
                  u.avatar_url AS member_avatar
           FROM smm_daily_journal dj
           LEFT JOIN projects p ON p.id = dj.project_id
           LEFT JOIN users u    ON u.id = dj.submitted_by
           WHERE dj.journal_date = ? AND dj.submitted_by IN (?)
           ORDER BY dj.submitted_by`,
          [today, memberIds]
        );

        const submittedIds = new Set(submitted.map(r => r.submitted_by));

        // Who hasn't submitted?
        const [members] = await db.query(
          `SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS name,
                  u.avatar_url, u.designation
           FROM users u
           WHERE u.id IN (?) ORDER BY u.first_name`,
          [memberIds]
        );

        const notSubmitted = members.filter(m => !submittedIds.has(m.id));

        dailyUpdates = {
          submitted,
          not_submitted: notSubmitted,
          summary: {
            total_members: memberIds.length,
            submitted_count: submittedIds.size,
            not_submitted_count: notSubmitted.length,
            escalations: submitted.filter(s => s.escalation_required === 'yes').length,
            critical: submitted.filter(s => s.health_status === 'critical').length,
            attention_needed: submitted.filter(s => s.health_status === 'attention_needed').length,
          },
        };
      }
    } catch (err) {
      console.error('getSmOps dailyUpdates error:', err.message);
    }

    // ── 7. PER-PLAN PROGRESS ─────────────────────────────────────────────────
    let planProgress = [];
    try {
      // Post counts per plan
      const [postStats] = await db.query(
        `SELECT plan_id,
                COUNT(*) AS total,
                SUM(CASE WHEN slot_status = 'approved' OR slot_status = 'completed' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN slot_status IN ('submitted','smm_approved') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN slot_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN slot_status = 'open' OR slot_status = 'assigned' THEN 1 ELSE 0 END) AS in_progress
         FROM content_calendar_posts
         WHERE plan_id IN (?)
         GROUP BY plan_id`,
        [planIds]
      );
      // Shoot counts per plan
      const [shootStats] = await db.query(
        `SELECT plan_id,
                COUNT(*) AS total,
                SUM(CASE WHEN slot_status = 'approved' OR slot_status = 'completed' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN slot_status IN ('submitted','smm_approved') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN slot_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN slot_status = 'open' OR slot_status = 'assigned' THEN 1 ELSE 0 END) AS in_progress
         FROM content_calendar_shoots
         WHERE plan_id IN (?)
         GROUP BY plan_id`,
        [planIds]
      );
      // Ad counts per plan
      const [adStats] = await db.query(
        `SELECT plan_id,
                COUNT(*) AS total,
                SUM(CASE WHEN slot_status = 'approved' OR slot_status = 'completed' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN slot_status IN ('submitted','smm_approved') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN slot_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN slot_status = 'open' OR slot_status = 'assigned' THEN 1 ELSE 0 END) AS in_progress
         FROM content_calendar_ads
         WHERE plan_id IN (?)
         GROUP BY plan_id`,
        [planIds]
      );

      // Merge into a plan-keyed map
      const statsMap = {};
      const merge = (rows, type) => {
        rows.forEach(r => {
          if (!statsMap[r.plan_id]) statsMap[r.plan_id] = { posts: {}, shoots: {}, ads: {} };
          statsMap[r.plan_id][type] = {
            total: Number(r.total) || 0,
            approved: Number(r.approved) || 0,
            pending: Number(r.pending) || 0,
            rejected: Number(r.rejected) || 0,
            in_progress: Number(r.in_progress) || 0,
          };
        });
      };
      merge(postStats, 'posts');
      merge(shootStats, 'shoots');
      merge(adStats, 'ads');

      planProgress = planRows.map(p => {
        const s = statsMap[p.id] || { posts: {}, shoots: {}, ads: {} };
        const empty = { total: 0, approved: 0, pending: 0, rejected: 0, in_progress: 0 };
        const posts  = s.posts  || empty;
        const shoots = s.shoots || empty;
        const ads    = s.ads    || empty;

        const totalAll    = posts.total    + shoots.total    + ads.total;
        const approvedAll = posts.approved + shoots.approved + ads.approved;
        const pendingAll  = posts.pending  + shoots.pending  + ads.pending;
        const rejectedAll = posts.rejected + shoots.rejected + ads.rejected;
        const progress    = totalAll > 0 ? Math.round((approvedAll / totalAll) * 100) : 0;

        return {
          plan_id: p.id,
          client_name: p.client_name,
          project_name: p.project_name,
          plan_month: p.plan_month,
          total: totalAll,
          approved: approvedAll,
          pending: pendingAll,
          rejected: rejectedAll,
          progress,
          posts,
          shoots,
          ads,
        };
      }).filter(p => p.total > 0); // only plans that have slots
    } catch (err) {
      console.error('getSmOps planProgress error:', err.message);
    }

    return res.json({
      approval_queue: approvalQueue,
      delayed_slots:  delayedSlots,
      rejected_slots: rejectedSlots,
      upcoming_shoots: upcomingShoots,
      ad_campaigns:   adCampaigns,
      daily_updates:  dailyUpdates,
      plan_progress:  planProgress,
    });
  } catch (err) {
    console.error('getSmOps fatal error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
