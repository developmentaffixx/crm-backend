const db = require('../config/db');

/**
 * GET /api/notifications/unified
 * Returns a unified notification feed for the current user.
 * - Admin: sees ALL notifications across the system
 * - Regular user: sees ONLY notifications relevant to them
 *   (assigned to them, created by them, or they are a member/participant)
 *
 * Categories:
 *  1. Lead follow-up reminders (overdue / due today / tomorrow)
 *  2. Task deadlines (overdue / due today / upcoming 2 days)
 *  3. Meeting reminders (today's scheduled meetings)
 *  4. Ticket alerts (overdue / due today / new assigned)
 *  5. Leave requests pending approval (admin only)
 *  6. Invoice overdue alerts (admin only)
 *  7. Unread announcements
 */
exports.getUnifiedNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;
    const notifications = [];

    // ─── 1. Lead Follow-up Reminders ────────────────────────────────────────────
    {
      let userFilter = '';
      const params = [];
      if (!isAdmin) {
        userFilter = 'AND (l.assigned_to = ? OR l.created_by = ?)';
        params.push(userId, userId);
      }

      const [rows] = await db.query(
        `SELECT f.id, f.lead_id, f.type, f.note, f.follow_up_date,
                l.name AS lead_name,
                DATEDIFF(CURDATE(), DATE(f.follow_up_date)) AS days_overdue
         FROM lead_follow_ups f
         JOIN leads l ON l.id = f.lead_id AND l.deleted = 0
         WHERE f.follow_up_date IS NOT NULL
           AND DATE(f.follow_up_date) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
           AND DATE(f.follow_up_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
           ${userFilter}
         ORDER BY f.follow_up_date ASC
         LIMIT 15`,
        params
      );

      rows.forEach(r => {
        const isOverdue = r.days_overdue > 0;
        const isDueToday = r.days_overdue === 0;
        notifications.push({
          id: `lead-${r.id}`,
          category: 'lead_followup',
          priority: isOverdue ? 'high' : isDueToday ? 'medium' : 'low',
          title: r.lead_name,
          subtitle: `${r.type}: ${r.note || ''}`.trim(),
          message: isOverdue
            ? `Overdue by ${r.days_overdue} day${r.days_overdue > 1 ? 's' : ''}`
            : isDueToday ? 'Due today' : 'Due tomorrow',
          link: `/revenue/leads/${r.lead_id}`,
          date: r.follow_up_date,
          days_overdue: r.days_overdue,
        });
      });
    }

    // ─── 2. Task Deadlines ──────────────────────────────────────────────────────
    {
      let userFilter = '';
      const params = [];
      if (!isAdmin) {
        userFilter = `AND (t.assigned_to = ? OR t.created_by = ? OR EXISTS (
          SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?
        ))`;
        params.push(userId, userId, userId);
      }

      const [rows] = await db.query(
        `SELECT t.id, t.task_id_code, t.title, t.deadline, t.priority AS task_priority, t.status,
                DATEDIFF(CURDATE(), t.deadline) AS days_overdue,
                CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         WHERE t.deleted = 0
           AND t.is_active >= 1
           AND t.status != 'done'
           AND t.deadline IS NOT NULL
           AND t.deadline <= DATE_ADD(CURDATE(), INTERVAL 2 DAY)
           AND t.deadline >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
           ${userFilter}
         ORDER BY t.deadline ASC
         LIMIT 15`,
        params
      );

      rows.forEach(r => {
        const isOverdue = r.days_overdue > 0;
        const isDueToday = r.days_overdue === 0;
        notifications.push({
          id: `task-${r.id}`,
          category: 'task_deadline',
          priority: isOverdue ? 'high' : isDueToday ? 'medium' : 'low',
          title: r.title,
          subtitle: `${r.task_id_code || ''} • ${r.assigned_to_name || 'Unassigned'}`,
          message: isOverdue
            ? `Overdue by ${r.days_overdue} day${r.days_overdue > 1 ? 's' : ''}`
            : isDueToday ? 'Deadline today' : 'Deadline tomorrow',
          link: `/tasks`,
          date: r.deadline,
          days_overdue: r.days_overdue,
        });
      });
    }

    // ─── 3. Today's Meetings ────────────────────────────────────────────────────
    {
      let userFilter = '';
      const params = [];
      if (!isAdmin) {
        userFilter = 'AND (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_members WHERE user_id = ?))';
        params.push(userId, userId);
      }

      const [rows] = await db.query(
        `SELECT m.id, m.title, m.meeting_date, m.start_time, m.end_time,
                m.location_type, m.status
         FROM meetings m
         WHERE m.deleted = 0
           AND m.status = 'scheduled'
           AND m.meeting_date = CURDATE()
           ${userFilter}
         ORDER BY m.start_time ASC
         LIMIT 10`,
        params
      );

      rows.forEach(r => {
        notifications.push({
          id: `meeting-${r.id}`,
          category: 'meeting',
          priority: 'medium',
          title: r.title,
          subtitle: `${r.start_time?.toString().slice(0, 5)} - ${r.end_time?.toString().slice(0, 5)}`,
          message: `Scheduled today • ${r.location_type}`,
          link: `/meetings`,
          date: r.meeting_date,
          days_overdue: 0,
        });
      });
    }

    // ─── 4. Ticket Alerts ───────────────────────────────────────────────────────
    {
      let userFilter = '';
      const params = [];
      if (!isAdmin) {
        userFilter = 'AND (t.assigned_to = ? OR t.reported_by = ?)';
        params.push(userId, userId);
      }

      const [rows] = await db.query(
        `SELECT t.id, t.title, t.due_date, t.priority, t.status, t.ticket_type,
                DATEDIFF(CURDATE(), t.due_date) AS days_overdue,
                CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
         FROM tickets t
         LEFT JOIN users u ON u.id = t.assigned_to
         WHERE t.deleted = 0
           AND t.status NOT IN ('resolved', 'closed')
           AND t.due_date IS NOT NULL
           AND t.due_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
           AND t.due_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
           ${userFilter}
         ORDER BY t.due_date ASC
         LIMIT 10`,
        params
      );

      rows.forEach(r => {
        const isOverdue = r.days_overdue > 0;
        const isDueToday = r.days_overdue === 0;
        notifications.push({
          id: `ticket-${r.id}`,
          category: 'ticket',
          priority: isOverdue ? 'high' : isDueToday ? 'medium' : 'low',
          title: r.title,
          subtitle: `${r.ticket_type} • ${r.assigned_to_name || 'Unassigned'}`,
          message: isOverdue
            ? `Overdue by ${r.days_overdue} day${r.days_overdue > 1 ? 's' : ''}`
            : isDueToday ? 'Due today' : 'Due tomorrow',
          link: `/tickets`,
          date: r.due_date,
          days_overdue: r.days_overdue,
        });
      });
    }

    // ─── 5. Pending Leave Approvals (Admin only) ────────────────────────────────
    if (isAdmin) {
      const [rows] = await db.query(
        `SELECT l.id, l.user_id, l.leave_type, l.from_date, l.to_date, l.days, l.reason,
                CONCAT(u.first_name, ' ', u.last_name) AS employee_name
         FROM leaves l
         JOIN users u ON u.id = l.user_id
         WHERE l.deleted = 0 AND l.status = 'pending'
         ORDER BY l.created_at DESC
         LIMIT 10`
      );

      rows.forEach(r => {
        notifications.push({
          id: `leave-${r.id}`,
          category: 'leave_approval',
          priority: 'medium',
          title: `${r.employee_name} — Leave Request`,
          subtitle: `${r.leave_type} • ${r.days} day${r.days > 1 ? 's' : ''}`,
          message: `${new Date(r.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} → ${new Date(r.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
          link: `/leaves`,
          date: r.from_date,
          days_overdue: 0,
        });
      });
    }

    // ─── 6. Overdue Invoices (Admin only) ───────────────────────────────────────
    if (isAdmin) {
      const [rows] = await db.query(
        `SELECT i.id, i.invoice_number, i.due_date, i.balance_amount, i.status,
                l.business_name AS client_name,
                DATEDIFF(CURDATE(), i.due_date) AS days_overdue
         FROM invoices i
         LEFT JOIN leads l ON l.id = i.lead_id
         WHERE i.deleted = 0
           AND i.status IN ('New', 'Partial', 'Overdue')
           AND i.due_date < CURDATE()
           AND i.balance_amount > 0
         ORDER BY i.due_date ASC
         LIMIT 10`
      );

      rows.forEach(r => {
        notifications.push({
          id: `invoice-${r.id}`,
          category: 'invoice_overdue',
          priority: 'high',
          title: `Invoice ${r.invoice_number}`,
          subtitle: r.client_name || 'Unknown client',
          message: `₹${Number(r.balance_amount).toLocaleString('en-IN')} overdue by ${r.days_overdue} day${r.days_overdue > 1 ? 's' : ''}`,
          link: `/finance/invoices`,
          date: r.due_date,
          days_overdue: r.days_overdue,
        });
      });
    }

    // ─── 7. Unread Announcements ────────────────────────────────────────────────
    {
      const [rows] = await db.query(
        `SELECT a.id, a.title, a.priority AS announce_priority, a.created_at
         FROM announcements a
         WHERE a.deleted = 0
           AND a.id NOT IN (SELECT announcement_id FROM announcement_reads WHERE user_id = ?)
         ORDER BY a.created_at DESC
         LIMIT 5`,
        [userId]
      );

      rows.forEach(r => {
        notifications.push({
          id: `announce-${r.id}`,
          category: 'announcement',
          priority: r.announce_priority === 'urgent' ? 'high' : r.announce_priority === 'important' ? 'medium' : 'low',
          title: r.title,
          subtitle: 'Company Announcement',
          message: r.announce_priority === 'urgent' ? '🔴 Urgent' : r.announce_priority === 'important' ? '🟡 Important' : 'New announcement',
          link: `/announcements`,
          date: r.created_at,
          days_overdue: 0,
        });
      });
    }

    // ─── 8. Content Calendar Slot Assignments ─────────────────────────────────────
    try {
      let slotWhere = "cp.slot_status IN ('picked_up','rejected') AND cp.assigned_to = ?";
      const slotParams = [userId];

      const [postSlots] = await db.query(
        `SELECT cp.id, cp.format, cp.posting_date, cp.slot_status, cp.rejection_reason, cp.assigned_to,
                p.plan_month, pr.title AS project_title
         FROM content_calendar_posts cp
         JOIN content_calendar_plans p ON p.id = cp.plan_id AND p.deleted = 0
         LEFT JOIN projects pr ON pr.id = p.project_id
         WHERE ${slotWhere}`,
        slotParams
      );

      postSlots.forEach(r => {
        notifications.push({
          id: `slot-post-${r.id}`,
          category: 'content_slot',
          priority: r.slot_status === 'rejected' ? 'high' : 'medium',
          title: r.slot_status === 'rejected' ? `Post Slot rejected — needs re-edit` : `Post Slot assigned to you`,
          subtitle: r.project_title || 'Content Calendar',
          message: r.slot_status === 'rejected' ? `❌ ${r.rejection_reason || 'Please re-edit'}` : `📝 ${(r.format || 'post').replace('_', ' ')} — ${r.posting_date ? r.posting_date.toISOString().split('T')[0] : ''}`,
          link: '/social/content-calendar',
          date: r.posting_date || new Date(),
          days_overdue: 0,
        });
      });

      const [shootSlots] = await db.query(
        `SELECT cs.id, cs.shoot_date, cs.slot_status, cs.rejection_reason,
                p.plan_month, pr.title AS project_title
         FROM content_calendar_shoots cs
         JOIN content_calendar_plans p ON p.id = cs.plan_id AND p.deleted = 0
         LEFT JOIN projects pr ON pr.id = p.project_id
         WHERE cs.slot_status IN ('picked_up','rejected') AND cs.assigned_to = ?`,
        [userId]
      );

      shootSlots.forEach(r => {
        notifications.push({
          id: `slot-shoot-${r.id}`,
          category: 'content_slot',
          priority: r.slot_status === 'rejected' ? 'high' : 'medium',
          title: r.slot_status === 'rejected' ? `Shoot Slot rejected — needs re-edit` : `Shoot Slot assigned to you`,
          subtitle: r.project_title || 'Content Calendar',
          message: r.slot_status === 'rejected' ? `❌ ${r.rejection_reason || 'Please re-edit'}` : `📸 Shoot — ${r.shoot_date ? r.shoot_date.toISOString().split('T')[0] : ''}`,
          link: '/social/content-calendar',
          date: r.shoot_date || new Date(),
          days_overdue: 0,
        });
      });

      const [adSlots] = await db.query(
        `SELECT ca.id, ca.platform, ca.start_date, ca.slot_status, ca.rejection_reason,
                p.plan_month, pr.title AS project_title
         FROM content_calendar_ads ca
         JOIN content_calendar_plans p ON p.id = ca.plan_id AND p.deleted = 0
         LEFT JOIN projects pr ON pr.id = p.project_id
         WHERE ca.slot_status IN ('picked_up','rejected') AND ca.assigned_to = ?`,
        [userId]
      );

      adSlots.forEach(r => {
        notifications.push({
          id: `slot-ad-${r.id}`,
          category: 'content_slot',
          priority: r.slot_status === 'rejected' ? 'high' : 'medium',
          title: r.slot_status === 'rejected' ? `Ad Slot rejected — needs re-edit` : `Ad Slot assigned to you`,
          subtitle: r.project_title || 'Content Calendar',
          message: r.slot_status === 'rejected' ? `❌ ${r.rejection_reason || 'Please re-edit'}` : `💰 Ad — ${r.platform || ''}`,
          link: '/social/content-calendar',
          date: r.start_date || new Date(),
          days_overdue: 0,
        });
      });
    } catch (slotErr) {
      // Silently skip if slot columns don't exist yet
      if (slotErr.code !== 'ER_BAD_FIELD_ERROR' && slotErr.code !== 'ER_NO_SUCH_TABLE') {
        console.error('Slot notifications error:', slotErr.message);
      }
    }

    // ─── Sort: high priority first, then by date ────────────────────────────────
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    notifications.sort((a, b) => {
      const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      return (b.days_overdue ?? 0) - (a.days_overdue ?? 0);
    });

    // Summary counts
    const summary = {
      total: notifications.length,
      high: notifications.filter(n => n.priority === 'high').length,
      medium: notifications.filter(n => n.priority === 'medium').length,
      low: notifications.filter(n => n.priority === 'low').length,
      byCategory: {
        lead_followup: notifications.filter(n => n.category === 'lead_followup').length,
        task_deadline: notifications.filter(n => n.category === 'task_deadline').length,
        meeting: notifications.filter(n => n.category === 'meeting').length,
        ticket: notifications.filter(n => n.category === 'ticket').length,
        leave_approval: notifications.filter(n => n.category === 'leave_approval').length,
        invoice_overdue: notifications.filter(n => n.category === 'invoice_overdue').length,
        announcement: notifications.filter(n => n.category === 'announcement').length,
        content_slot: notifications.filter(n => n.category === 'content_slot').length,
      },
    };

    return res.json({ notifications, summary });
  } catch (err) {
    console.error('Unified notifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
