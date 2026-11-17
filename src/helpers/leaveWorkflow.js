const db = require('../config/db');
const { emitEvent } = require('../config/socket');

/**
 * Heads an employee can tag as coordinator: the head(s) of the employee's team,
 * excluding the employee themself. Empty array = employee has no head
 * (leave then goes straight to HR / Admin).
 */
async function getHeadsOfUser(userId) {
  const [mine] = await db.query('SELECT team_id FROM team_members WHERE user_id = ? LIMIT 1', [userId]);
  if (!mine.length) return [];
  const [heads] = await db.query(
    `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.role = 'head' AND tm.user_id <> ?
       AND u.deleted = 0 AND u.is_active = 1
     ORDER BY u.first_name`,
    [mine[0].team_id, userId]
  );
  return heads;
}

/**
 * HR / Admin recipients = active admins + anyone with leave-approval ("All") access.
 */
async function getHrRecipientIds() {
  const { hasLeavesAllAccess } = require('../controllers/leaves.controller');
  const [users] = await db.query('SELECT id, is_admin FROM users WHERE deleted = 0 AND is_active = 1');
  const ids = [];
  for (const u of users) {
    if (u.is_admin === 1 || (await hasLeavesAllAccess({ id: u.id, is_admin: false }))) ids.push(u.id);
  }
  return ids;
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const DURATION = { full_day: 'Full Day', first_half: 'First Half', second_half: 'Second Half' };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/**
 * Create in-app notifications for a leave event.
 *   type: requested | head_approved | head_rejected | approved | rejected | cancelled
 * Recipients (the actor is always excluded):
 *   requested     → HR/Admin + tagged coordinator
 *   head_approved → employee + HR/Admin  (now waiting for HR's final decision)
 *   head_rejected → employee + HR/Admin
 *   approved      → employee + tagged coordinator + HR/Admin
 *   rejected      → employee + tagged coordinator + HR/Admin
 *   cancelled     → HR/Admin + tagged coordinator
 * Never throws: a notification failure must not break the leave action.
 */
async function notifyLeave(leaveId, type, actorId) {
  try {
    const [rows] = await db.query(
      `SELECT l.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name
       FROM leaves l JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
      [leaveId]
    );
    if (!rows.length) return;
    const l = rows[0];

    const hr = await getHrRecipientIds();
    const recipients = new Set();
    const addEmployee = () => recipients.add(l.user_id);
    const addCoordinator = () => l.coordinator_id && recipients.add(l.coordinator_id);
    const addHr = () => hr.forEach((id) => recipients.add(id));

    const statusLabel = {
      requested: 'Requested',
      head_approved: 'Approved by Head – awaiting HR',
      head_rejected: 'Rejected by Head',
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
    }[type];

    switch (type) {
      case 'requested': case 'cancelled': addHr(); addCoordinator(); break;
      case 'head_approved': case 'head_rejected': addEmployee(); addHr(); break;
      default: addEmployee(); addCoordinator(); addHr();
    }
    recipients.delete(actorId);
    if (!recipients.size) return;

    const range = l.from_date && l.to_date && String(l.from_date) !== String(l.to_date)
      ? `${fmtDate(l.from_date)} – ${fmtDate(l.to_date)}`
      : fmtDate(l.from_date);
    const days = `${Number(l.days)} day${Number(l.days) === 1 ? '' : 's'}`;
    const title = `${l.employee_name} — Leave ${statusLabel.split(' ')[0]}`;
    const message =
      `${cap(l.leave_type)} leave (${DURATION[l.duration] || 'Full Day'}) • ${range} • ${days}` +
      (l.reason ? ` • Reason: ${l.reason}` : '') +
      ` • Status: ${statusLabel}`;

    for (const uid of recipients) {
      await db.query(
        'INSERT INTO leave_notifications (user_id, leave_id, type, title, message) VALUES (?, ?, ?, ?, ?)',
        [uid, leaveId, type, title, message]
      );
      emitEvent('leaves:updated', { id: leaveId, status: l.status }, `user:${uid}`);
    }
  } catch (err) {
    console.error('notifyLeave error:', err.message);
  }
}

module.exports = { getHeadsOfUser, getHrRecipientIds, notifyLeave };
