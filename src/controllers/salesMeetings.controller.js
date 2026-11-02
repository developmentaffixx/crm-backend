const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After a meeting outcome is set, write a corresponding follow-up entry
 * on the linked lead so lead history and meeting history always stay in sync.
 */
async function syncFollowUpFromMeeting(meeting, userId) {
  if (!meeting.lead_id) return null;

  const outcomeMap = {
    attended:    'Meeting Scheduled',
    no_show:     'Callback Requested',
    rescheduled: 'Callback Requested',
    converted:   'Converted',
    follow_up:   'Meeting Scheduled',
  };

  const typeMap = {
    online:  'Meeting',
    offline: 'Meeting',
  };

  const outcome = outcomeMap[meeting.outcome];
  if (!outcome) return null; // pending — nothing to sync yet

  const noteMap = {
    attended:    `Meeting attended (${meeting.mode}). Post-meeting: ${meeting.post_confirmed_note || '—'}`,
    no_show:     `Client no-show for scheduled ${meeting.mode} meeting on ${meeting.meeting_date}.`,
    rescheduled: `Meeting rescheduled from ${meeting.meeting_date}. ${meeting.post_confirmed_note || ''}`,
    converted:   `🎉 Deal converted during ${meeting.mode} meeting on ${meeting.meeting_date}. ${meeting.post_confirmed_note || ''}`,
    follow_up:   `Meeting done. Next meeting required. ${meeting.post_confirmed_note || ''}`,
  };

  const note = noteMap[meeting.outcome] || `Meeting outcome: ${meeting.outcome}`;

  // Next follow-up date: tomorrow by default
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const follow_up_date = tomorrow.toISOString().slice(0, 10);

  const [result] = await db.query(
    `INSERT INTO lead_follow_ups (lead_id, type, outcome, note, follow_up_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [
      meeting.lead_id,
      typeMap[meeting.mode] || 'Meeting',
      outcome,
      note,
      follow_up_date,
      userId,
    ]
  );

  // Update the meeting row to record which follow-up was created
  await db.query(
    'UPDATE sales_meetings SET linked_follow_up_id = ? WHERE id = ?',
    [result.insertId, meeting.id]
  );

  // Auto-advance lead stage based on outcome
  const stageMap = {
    attended:    { stage: 'Meeting',      temperature: 'hot',  score: 4 },
    no_show:     { stage: 'Contacted',    temperature: 'cold', score: 1 },
    rescheduled: { stage: 'Meeting',      temperature: 'warm', score: 3 },
    converted:   { stage: 'Won',          temperature: 'hot',  score: 5 },
    follow_up:   { stage: 'Proposal',     temperature: 'hot',  score: 4 },
  };

  const advance = stageMap[meeting.outcome];
  if (advance) {
    // Only advance stage (never go backward, except Won/Lost)
    const stageOrder = ['New','Contacted','Replied','Interested','Qualified','Meeting','Proposal','Negotiation','Won','Lost'];
    const [leadRows] = await db.query('SELECT lead_stage, status FROM leads WHERE id = ?', [meeting.lead_id]);
    if (leadRows.length > 0) {
      const currentIdx = stageOrder.indexOf(leadRows[0].lead_stage || 'New');
      const newIdx = stageOrder.indexOf(advance.stage);
      if (advance.stage === 'Won' || advance.stage === 'Lost' || newIdx > currentIdx) {
        if (advance.stage === 'Won') {
          // Generate client code if not already set
          const [existLead] = await db.query('SELECT client_code FROM leads WHERE id = ?', [meeting.lead_id]);
          if (!existLead[0]?.client_code) {
            const [maxRows] = await db.query(
              `SELECT MAX(CAST(SUBSTRING(client_code, 6) AS UNSIGNED)) AS max_seq FROM leads WHERE client_code IS NOT NULL AND client_code LIKE 'AFXCL%'`
            );
            const seq = String((maxRows[0]?.max_seq || 0) + 1).padStart(3, '0');
            const client_code = `AFXCL${seq}`;
            await db.query(
              `UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ?, client_code = ?, converted_at = NOW() WHERE id = ?`,
              [advance.stage, advance.stage, advance.temperature, advance.score, client_code, meeting.lead_id]
            );
          } else {
            await db.query(
              `UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ? WHERE id = ?`,
              [advance.stage, advance.stage, advance.temperature, advance.score, meeting.lead_id]
            );
          }
        } else {
          await db.query(
            `UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ? WHERE id = ?`,
            [advance.stage, advance.stage, advance.temperature, advance.score, meeting.lead_id]
          );
        }
        // Record in lead history
        await db.query(
          'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
          [meeting.lead_id, leadRows[0].lead_stage || 'New', advance.stage, userId]
        );
      }
    }
  }

  return result.insertId;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings
// Query params: start, end (YYYY-MM-DD), user_id (admin only), lead_id
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { start, end, user_id, lead_id } = req.query;

    let where = 'sm.deleted = 0';
    const params = [];

    if (start) { where += ' AND sm.meeting_date >= ?'; params.push(start); }
    if (end)   { where += ' AND sm.meeting_date <= ?'; params.push(end); }
    if (lead_id) { where += ' AND sm.lead_id = ?'; params.push(lead_id); }

    // Non-admin can only see their own meetings
    if (!req.user.is_admin) {
      where += ' AND sm.created_by = ?';
      params.push(req.user.id);
    } else if (user_id) {
      where += ' AND sm.created_by = ?';
      params.push(user_id);
    }

    const [rows] = await db.query(
      `SELECT
         sm.*,
         l.name          AS lead_name,
         l.lead_id       AS lead_code,
         l.business_name AS lead_business,
         l.lead_stage    AS lead_stage,
         CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM sales_meetings sm
       LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = sm.created_by
       WHERE ${where}
       ORDER BY sm.meeting_date ASC, FIELD(sm.slot, 'morning', 'afternoon', 'evening')`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('Sales meetings list error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings/stats
// Weekly + monthly target progress
// Query: user_id (admin only), week_start (YYYY-MM-DD), month (YYYY-MM)
// ─────────────────────────────────────────────────────────────────────────────
exports.stats = async (req, res) => {
  try {
    const { week_start, month, user_id } = req.query;

    let userFilter = '';
    const baseParams = [];

    if (!req.user.is_admin) {
      userFilter = 'AND sm.created_by = ?';
      baseParams.push(req.user.id);
    } else if (user_id) {
      userFilter = 'AND sm.created_by = ?';
      baseParams.push(parseInt(user_id));
    }

    // Week stats (Mon–Fri by default)
    let weeklyCount = 0;
    if (week_start) {
      const [weekRows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM sales_meetings sm
         WHERE sm.deleted = 0
           AND sm.meeting_date >= ?
           AND sm.meeting_date < DATE_ADD(?, INTERVAL 5 DAY)
           AND sm.outcome != 'no_show'
           ${userFilter}`,
        [week_start, week_start, ...baseParams]
      );
      weeklyCount = weekRows[0]?.cnt || 0;
    }

    // Monthly stats
    let monthlyCount = 0;
    if (month) {
      const [monthRows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM sales_meetings sm
         WHERE sm.deleted = 0
           AND DATE_FORMAT(sm.meeting_date, '%Y-%m') = ?
           AND sm.outcome != 'no_show'
           ${userFilter}`,
        [month, ...baseParams]
      );
      monthlyCount = monthRows[0]?.cnt || 0;
    }

    // Outcome breakdown for the month
    let outcomeBreakdown = [];
    if (month) {
      const [obRows] = await db.query(
        `SELECT outcome, COUNT(*) AS cnt FROM sales_meetings sm
         WHERE sm.deleted = 0
           AND DATE_FORMAT(sm.meeting_date, '%Y-%m') = ?
           ${userFilter}
         GROUP BY outcome`,
        [month, ...baseParams]
      );
      outcomeBreakdown = obRows;
    }

    return res.json({
      weekly:  { count: weeklyCount,  target: 15 },
      monthly: { count: monthlyCount, target: 60 },
      outcomeBreakdown,
    });
  } catch (err) {
    console.error('Sales meetings stats error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sales-meetings
// Body: { meeting_date, slot, lead_id?, mode?, title?, notes? }
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { meeting_date, slot, lead_id, mode, title, notes } = req.body;
    if (!meeting_date) return res.status(400).json({ message: 'meeting_date is required' });
    if (!slot || !['morning','afternoon','evening'].includes(slot)) {
      return res.status(400).json({ message: 'slot must be morning, afternoon, or evening' });
    }

    const [result] = await db.query(
      `INSERT INTO sales_meetings (lead_id, created_by, meeting_date, slot, mode, title, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id || null,
        req.user.id,
        meeting_date,
        slot,
        mode || 'online',
        title || null,
        notes || null,
      ]
    );

    const [rows] = await db.query(
      `SELECT sm.*, l.name AS lead_name, l.lead_id AS lead_code, l.business_name AS lead_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM sales_meetings sm
       LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Sales meeting create error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT sm.*, l.name AS lead_name, l.lead_id AS lead_code, l.business_name AS lead_business,
              l.lead_stage, l.temperature, l.phone AS lead_phone,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM sales_meetings sm
       LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.id = ? AND sm.deleted = 0`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Sales meeting getOne error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sales-meetings/:id
// Full update (edit title, date, slot, lead, mode, notes)
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sales_meetings WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });
    const meeting = rows[0];

    if (!req.user.is_admin && meeting.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { meeting_date, slot, lead_id, mode, title, notes } = req.body;

    await db.query(
      `UPDATE sales_meetings SET
         meeting_date = COALESCE(?, meeting_date),
         slot = COALESCE(?, slot),
         lead_id = ?,
         mode = COALESCE(?, mode),
         title = ?,
         notes = ?
       WHERE id = ?`,
      [
        meeting_date || null,
        slot || null,
        lead_id !== undefined ? (lead_id || null) : meeting.lead_id,
        mode || null,
        title !== undefined ? (title || null) : meeting.title,
        notes !== undefined ? (notes || null) : meeting.notes,
        req.params.id,
      ]
    );

    const [updated] = await db.query(
      `SELECT sm.*, l.name AS lead_name, l.lead_id AS lead_code, l.business_name AS lead_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM sales_meetings sm
       LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Sales meeting update error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sales-meetings/:id/pre-confirm
// Mark pre-meeting confirmation
// ─────────────────────────────────────────────────────────────────────────────
exports.preConfirm = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sales_meetings WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });
    const meeting = rows[0];

    if (!req.user.is_admin && meeting.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query(
      `UPDATE sales_meetings SET pre_confirmed = 1, pre_confirmed_at = NOW(), pre_confirmed_by = ? WHERE id = ?`,
      [req.user.id, req.params.id]
    );

    const [updated] = await db.query('SELECT * FROM sales_meetings WHERE id = ?', [req.params.id]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Pre-confirm error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sales-meetings/:id/post-confirm
// Body: { outcome, post_confirmed_note }
// Sets post_confirmed, outcome, syncs follow-up to lead
// ─────────────────────────────────────────────────────────────────────────────
exports.postConfirm = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sales_meetings WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });
    const meeting = rows[0];

    if (!req.user.is_admin && meeting.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { outcome, post_confirmed_note } = req.body;
    const validOutcomes = ['attended','no_show','rescheduled','converted','follow_up'];
    if (!outcome || !validOutcomes.includes(outcome)) {
      return res.status(400).json({ message: `outcome must be one of: ${validOutcomes.join(', ')}` });
    }

    await db.query(
      `UPDATE sales_meetings SET
         post_confirmed = 1,
         post_confirmed_at = NOW(),
         post_confirmed_note = ?,
         outcome = ?
       WHERE id = ?`,
      [post_confirmed_note || null, outcome, req.params.id]
    );

    // Fetch updated meeting for follow-up sync
    const [updatedRows] = await db.query('SELECT * FROM sales_meetings WHERE id = ?', [req.params.id]);
    const updatedMeeting = updatedRows[0];

    // Sync to lead follow-ups
    await syncFollowUpFromMeeting(updatedMeeting, req.user.id);

    // Fetch final with join
    const [final] = await db.query(
      `SELECT sm.*, l.name AS lead_name, l.lead_id AS lead_code, l.business_name AS lead_business,
              l.lead_stage, l.temperature,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM sales_meetings sm
       LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = sm.created_by
       WHERE sm.id = ?`,
      [req.params.id]
    );

    return res.json(final[0]);
  } catch (err) {
    console.error('Post-confirm error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sales-meetings/:id (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sales_meetings WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });
    const meeting = rows[0];

    if (!req.user.is_admin && meeting.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('UPDATE sales_meetings SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Meeting deleted' });
  } catch (err) {
    console.error('Sales meeting delete error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};
