const cron = require('node-cron');
const db = require('../config/db');
const { emitEvent } = require('../config/socket');

/**
 * Every 5 minutes:
 *  1. Due soon  — reminders (incl. meetings) due within the next 30 minutes → alert the head.
 *  2. Overdue   — open reminders past their due time → alert the head and the CEO who sent it.
 * Each alert is sent once (tracked by due_soon_notified_at / overdue_notified_at).
 * The bell/dashboard already show these states; this adds the live pop-up.
 */
async function runCeoReminderChecks() {
  try {
    // 1. Due soon
    const [dueSoon] = await db.query(
      `SELECT id, title, priority, type, recipient_user_id
         FROM ceo_reminders
        WHERE deleted = 0 AND due_soon_notified_at IS NULL
          AND status IN ('pending','viewed','acknowledged','in_progress')
          AND due_at IS NOT NULL AND due_at > NOW() AND due_at <= DATE_ADD(NOW(), INTERVAL 30 MINUTE)`
    );
    for (const r of dueSoon) {
      const isMeeting = r.type === 'meeting' || r.type === 'discussion';
      emitEvent('ceo-reminders:alert', {
        kind: 'due_soon', id: r.id, title: r.title, priority: r.priority,
        message: isMeeting ? `Meeting starts within 30 minutes: ${r.title}` : `Reminder due within 30 minutes: ${r.title}`,
      }, `user:${r.recipient_user_id}`);
    }
    if (dueSoon.length) {
      await db.query('UPDATE ceo_reminders SET due_soon_notified_at = NOW() WHERE id IN (?)', [dueSoon.map((r) => r.id)]);
    }

    // 2. Overdue
    const [overdue] = await db.query(
      `SELECT r.id, r.title, r.priority, r.recipient_user_id, r.created_by,
              CONCAT(u.first_name, ' ', u.last_name) AS recipient_name
         FROM ceo_reminders r
         LEFT JOIN users u ON u.id = r.recipient_user_id
        WHERE r.deleted = 0 AND r.overdue_notified_at IS NULL
          AND r.status IN ('pending','viewed','acknowledged','in_progress')
          AND r.due_at IS NOT NULL AND r.due_at < NOW()`
    );
    for (const r of overdue) {
      emitEvent('ceo-reminders:alert', {
        kind: 'overdue', id: r.id, title: r.title, priority: 'high',
        message: `Overdue reminder from CEO: ${r.title}`,
      }, `user:${r.recipient_user_id}`);
      emitEvent('ceo-reminders:alert', {
        kind: 'overdue', id: r.id, title: r.title, priority: 'high',
        message: `Overdue: ${r.recipient_name} — ${r.title}`,
      }, `user:${r.created_by}`);
      emitEvent('ceo-reminders:changed', { id: r.id }, `user:${r.recipient_user_id}`);
      emitEvent('ceo-reminders:changed', { id: r.id }, `user:${r.created_by}`);
    }
    if (overdue.length) {
      await db.query('UPDATE ceo_reminders SET overdue_notified_at = NOW() WHERE id IN (?)', [overdue.map((r) => r.id)]);
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('[ceo-reminders cron] error:', err.message);
  }
}

function startCeoRemindersCron() {
  cron.schedule('*/5 * * * *', runCeoReminderChecks);
  console.log('[ceo-reminders] cron scheduled (every 5 minutes)');
}

module.exports = { startCeoRemindersCron, runCeoReminderChecks };
