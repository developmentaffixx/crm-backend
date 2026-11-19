const db = require('../config/db');

// Where a sales meeting without an exact time sorts (start of its slot)
const SLOT_START = { morning: '09:00:00', afternoon: '12:00:00', evening: '16:00:00' };

const hhmmss = (t) => (t ? String(t).slice(0, 8) : null);

function durationMinutes(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? mins : null;
}

/**
 * GET /api/ceo-dashboard/todays-meetings
 * Today's meetings that involve the logged-in Founder, split into
 * Lead / Client / Team. Admins are NOT given a bypass: only meetings the
 * current user attends, created, or was added to as a member are returned.
 */
exports.getTodaysMeetings = async (req, res) => {
  const userId = req.user.id;

  async function safe(sql, params) {
    try {
      const [rows] = await db.query(sql, params);
      return rows;
    } catch (err) {
      console.error('[todays-meetings] query failed:', err.message);
      return [];
    }
  }

  try {
    const [leadRows, generalRows, dateRow, requestRows, pendingTotalRows] = await Promise.all([
      // Lead meetings: Sales Calendar meetings where the Founder is the attendee
      safe(
        `SELECT sm.id, sm.meeting_date, sm.slot, sm.start_time, sm.duration_minutes, sm.title, sm.notes, sm.mode, sm.meeting_type,
                sm.outcome, sm.pre_confirmed,
                l.name AS lead_name, l.business_name AS lead_business,
                CONCAT(u.first_name, ' ', u.last_name) AS sales_executive
           FROM sales_meetings sm
           LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
           LEFT JOIN users u ON u.id = sm.created_by
          WHERE sm.deleted = 0
            AND sm.meeting_date = CURDATE()
            AND sm.attendee_id = ?
            AND sm.outcome <> 'rescheduled'`,
        [userId]
      ),
      // Client + Team meetings: the Founder created it or is a member
      safe(
        `SELECT m.id, m.title, m.description, m.meeting_type, m.meeting_date, m.start_time, m.end_time,
                m.status, m.location_type,
                l.name AS client_name, l.business_name AS client_business,
                p.title AS project_name,
                CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
           FROM meetings m
           LEFT JOIN leads l ON l.id = m.client_id
           LEFT JOIN projects p ON p.id = m.project_id
           LEFT JOIN users u ON u.id = m.created_by
          WHERE m.deleted = 0
            AND m.meeting_date = CURDATE()
            AND m.status <> 'cancelled'
            AND (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_members WHERE user_id = ?))`,
        [userId, userId]
      ),
      safe('SELECT DATE_FORMAT(CURDATE(), "%Y-%m-%d") AS today', []),
      // Pending team-meeting requests addressed to the Founder that want today
      safe(
        `SELECT r.id, r.request_type, r.title, r.purpose, r.preferred_time, r.duration_minutes,
                CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name,
                COALESCE((SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.deleted = 0
                           WHERE tm.user_id = r.requested_by LIMIT 1), u.department) AS team_name
           FROM meeting_requests r JOIN users u ON u.id = r.requested_by
          WHERE r.founder_id = ? AND r.status = 'pending' AND r.preferred_date = CURDATE()`,
        [userId]
      ),
      // All pending requests (any date), for the "pending requests" button
      safe(
        `SELECT COUNT(*) AS n FROM meeting_requests WHERE founder_id = ? AND status = 'pending'`,
        [userId]
      ),
    ]);

    const lead = leadRows
      .map((r) => ({
        id: r.id,
        source: 'sales',
        category: 'lead',
        // Exact time when the sales executive set one; otherwise only the slot is known
        time: hhmmss(r.start_time),
        slot: r.slot,
        sort: hhmmss(r.start_time) || SLOT_START[r.slot] || '99',
        duration_minutes: r.duration_minutes || null,
        title: r.lead_business || r.lead_name || r.title || 'Sales meeting',
        subtitle: r.title && (r.lead_business || r.lead_name) ? r.title : null,
        agenda: r.notes || null,
        participants: [r.sales_executive].filter(Boolean),
        person: r.sales_executive || null,
        person_label: 'Sales',
        status: r.outcome === 'pending' ? (r.pre_confirmed ? 'confirmed' : 'scheduled') : r.outcome,
      }))
      .sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || a.id - b.id);

    // Participant names for the general (client / team) meetings
    const memberNames = {};
    if (generalRows.length) {
      const memberRows = await safe(
        `SELECT mm.meeting_id, CONCAT(u.first_name, ' ', u.last_name) AS name
           FROM meeting_members mm JOIN users u ON u.id = mm.user_id
          WHERE mm.meeting_id IN (?) ORDER BY u.first_name`,
        [generalRows.map((r) => r.id)]
      );
      memberRows.forEach((mr) => { (memberNames[mr.meeting_id] ||= []).push(mr.name); });
    }

    const toGeneral = (r) => ({
      id: r.id,
      source: 'general',
      time: hhmmss(r.start_time),
      sort: hhmmss(r.start_time) || '99',
      duration_minutes: durationMinutes(r.start_time, r.end_time),
      status: r.status,
      created_by_name: r.created_by_name || null,
      agenda: r.description || null,
      participants: memberNames[r.id] || [],
    });

    const client = generalRows
      .filter((r) => r.meeting_type === 'client')
      .map((r) => {
        const clientName = r.client_business || r.client_name;
        return {
          ...toGeneral(r),
          category: 'client',
          title: [clientName, r.project_name || r.title].filter(Boolean).join(' – ') || r.title,
          subtitle: null,
          person: r.created_by_name,
          person_label: 'Requested by',
        };
      })
      .sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || a.id - b.id);

    const team = generalRows
      .filter((r) => r.meeting_type === 'office')
      .map((r) => ({
        ...toGeneral(r),
        category: 'team',
        title: r.title,
        subtitle: null,
        person: r.created_by_name,
        person_label: 'Requested by',
      }))
      .concat(requestRows.map((r) => ({
        id: r.id,
        source: 'request',
        pending: true,
        category: 'team',
        time: hhmmss(r.preferred_time),
        sort: hhmmss(r.preferred_time) || '99',
        duration_minutes: r.duration_minutes || null,
        status: 'pending',
        title: r.title,
        subtitle: r.request_type === 'department' ? 'Department head request' : 'One-to-one request',
        agenda: r.purpose || null,
        participants: [],
        person: [r.requested_by_name, r.team_name].filter(Boolean).join(' · '),
        person_label: 'Requested by',
      })))
      .sort((a, b) => String(a.sort).localeCompare(String(b.sort)) || a.id - b.id);

    return res.json({
      pending_requests: Number(pendingTotalRows[0]?.n) || 0,
      date: dateRow[0]?.today || null,
      lead: { count: lead.length, meetings: lead },
      client: { count: client.length, meetings: client },
      team: { count: team.length, meetings: team },
    });
  } catch (err) {
    console.error('Todays meetings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
