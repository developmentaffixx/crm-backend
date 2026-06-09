const cron = require('node-cron');
const db = require('../config/db');
const nodemailer = require('nodemailer');

/**
 * Auto Clock-Out Cron Job
 * - Runs at 7:00 PM IST (13:30 UTC) every day via node-cron
 * - Also runs on server startup to catch any missed clock-outs
 * - Finds users still clocked in (today or past days)
 * - Auto clocks them out
 * - Stops any running task/ticket/meeting timers
 * - Sends email notification
 */

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendAutoClockOutEmail(user, clockOutTime) {
  try {
    const timeStr = new Date(clockOutTime).toLocaleTimeString('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
    });

    await transporter.sendMail({
      from: `"${process.env.APP_NAME || 'CRM'}" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: 'Auto Clock-Out Notification',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1f2937;">Hi ${user.first_name},</h2>
          <p style="color: #4b5563;">You forgot to clock out today. We've automatically clocked you out at <strong>${timeStr}</strong>.</p>
          <p style="color: #4b5563;">When you log in tomorrow, you'll be prompted to enter your actual clock-out time if it was different.</p>
          <div style="margin-top: 20px; padding: 12px; background: #fef3c7; border-radius: 8px;">
            <p style="color: #92400e; margin: 0; font-size: 14px;">⚠️ Please remember to clock out before leaving.</p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">This is an automated message.</p>
        </div>
      `,
    });
    console.log(`[CRON] Auto clock-out email sent to ${user.email}`);
  } catch (err) {
    console.error(`[CRON] Failed to send auto clock-out email to ${user.email}:`, err.message);
  }
}

/**
 * Main auto clock-out logic
 * @param {boolean} isCatchUp - If true, this is a startup catch-up run (handles past dates too)
 */
async function autoClockOut(isCatchUp = false) {
  console.log(`[CRON] Running auto clock-out ${isCatchUp ? '(catch-up)' : '(scheduled)'} at`, new Date().toISOString());

  try {
    // Find all users still clocked in with no clock_out
    // If catch-up: check all dates (handles server restarts/missed runs)
    // If scheduled: check only today
    const query = isCatchUp
      ? `SELECT a.id AS attendance_id, a.user_id, a.clock_in, a.date,
                u.first_name, u.last_name, u.email
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.clock_out IS NULL`
      : `SELECT a.id AS attendance_id, a.user_id, a.clock_in, a.date,
                u.first_name, u.last_name, u.email
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.date = CURDATE() AND a.clock_out IS NULL`;

    const [openAttendance] = await db.query(query);

    if (openAttendance.length === 0) {
      console.log('[CRON] No users to auto clock-out');
      return;
    }

    console.log(`[CRON] Found ${openAttendance.length} users still clocked in`);

    for (const record of openAttendance) {
      try {
        // Determine clock-out time: 7:00 PM IST (13:30 UTC) of the attendance date
        const attendanceDate = new Date(record.date);
        const clockOutTime = new Date(Date.UTC(
          attendanceDate.getFullYear(),
          attendanceDate.getMonth(),
          attendanceDate.getDate(),
          13, 30, 0 // 13:30 UTC = 7:00 PM IST
        ));

        // 1. Stop any running task timers for this user
        const [activeTaskTimers] = await db.query(
          `SELECT id, task_id, started_at FROM task_active_timers WHERE user_id = ?`,
          [record.user_id]
        );

        for (const timer of activeTaskTimers) {
          const startedAt = new Date(timer.started_at);
          const duration = Math.max(1, Math.floor((clockOutTime - startedAt) / 1000));

          // Save the time log
          await db.query(
            `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [timer.task_id, record.user_id, timer.started_at, clockOutTime, duration, 'Auto-stopped by system (forgot to clock out)']
          );

          // Update task time_spent
          await db.query(
            'UPDATE tasks SET time_spent = time_spent + ?, timer_started_at = NULL WHERE id = ?',
            [duration, timer.task_id]
          );

          // Remove active timer
          await db.query('DELETE FROM task_active_timers WHERE id = ?', [timer.id]);
        }

        // 2. Stop any running ticket timers
        const [activeTicketTimers] = await db.query(
          `SELECT id, ticket_id, started_at FROM ticket_active_timers WHERE user_id = ?`,
          [record.user_id]
        );

        for (const timer of activeTicketTimers) {
          const startedAt = new Date(timer.started_at);
          const duration = Math.max(1, Math.floor((clockOutTime - startedAt) / 1000));
          const minutes = Math.ceil(duration / 60);

          await db.query(
            `INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, note, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [timer.ticket_id, record.user_id, minutes, 'Auto-stopped by system (forgot to clock out)', clockOutTime]
          );

          await db.query('DELETE FROM ticket_active_timers WHERE id = ?', [timer.id]);
        }

        // 3. Stop any running meeting timers
        const [activeMeetingTimers] = await db.query(
          `SELECT id, meeting_id, started_at FROM meeting_active_timers WHERE user_id = ?`,
          [record.user_id]
        );

        for (const timer of activeMeetingTimers) {
          const startedAt = new Date(timer.started_at);
          const duration = Math.max(1, Math.floor((clockOutTime - startedAt) / 1000));

          await db.query(
            `INSERT INTO meeting_time_logs (meeting_id, user_id, started_at, ended_at, duration, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [timer.meeting_id, record.user_id, timer.started_at, clockOutTime, duration, 'Auto-stopped by system (forgot to clock out)']
          );

          await db.query('DELETE FROM meeting_active_timers WHERE id = ?', [timer.id]);
        }

        // 4. End any active AFS session
        const [activeAfs] = await db.query(
          `SELECT id, start_time FROM afs_logs WHERE user_id = ? AND end_time IS NULL`,
          [record.user_id]
        );

        for (const afs of activeAfs) {
          const afsDuration = Math.floor((clockOutTime - new Date(afs.start_time)) / 1000);
          await db.query(
            'UPDATE afs_logs SET end_time = ?, duration_seconds = ? WHERE id = ?',
            [clockOutTime, afsDuration, afs.id]
          );
          await db.query(
            'UPDATE attendance SET total_afs_seconds = total_afs_seconds + ? WHERE id = ?',
            [afsDuration, record.attendance_id]
          );
        }

        // 5. Calculate total served seconds and clock out
        const clockInTime = new Date(record.clock_in);
        const totalServedSeconds = Math.floor((clockOutTime - clockInTime) / 1000);

        await db.query(
          `UPDATE attendance 
           SET clock_out = ?, total_served_seconds = ?, auto_clock_out = 1
           WHERE id = ?`,
          [clockOutTime, totalServedSeconds, record.attendance_id]
        );

        // 6. Send email notification
        await sendAutoClockOutEmail(record, clockOutTime);

        console.log(`[CRON] Auto clocked-out: ${record.first_name} ${record.last_name} (date: ${record.date})`);
      } catch (userErr) {
        console.error(`[CRON] Error processing user ${record.user_id}:`, userErr.message);
      }
    }

    console.log('[CRON] Auto clock-out complete');
  } catch (err) {
    console.error('[CRON] Auto clock-out error:', err);
  }
}

/**
 * Start the auto clock-out cron scheduler
 * - Schedules daily at 7:00 PM IST (13:30 UTC)
 * - Runs catch-up immediately on startup for any missed clock-outs
 */
function startAutoClockOutCron() {
  // Run catch-up on startup: handle any missed auto-clock-outs (e.g., server was down)
  console.log('⏰  Running auto clock-out catch-up on startup...');
  autoClockOut(true);

  // Schedule: 13:30 UTC = 7:00 PM IST, every day
  cron.schedule('30 13 * * *', () => {
    autoClockOut(false);
  }, {
    timezone: 'UTC'
  });

  console.log('⏰  Auto clock-out cron scheduled for 7:00 PM IST (13:30 UTC) daily');
}

module.exports = { autoClockOut, startAutoClockOutCron };
