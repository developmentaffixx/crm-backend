const db = require('../config/db');
const nodemailer = require('nodemailer');

/**
 * Auto Clock-Out Cron Job
 * Runs at 7:00 PM daily
 * - Finds users still clocked in
 * - Auto clocks them out at 7:00 PM
 * - Stops any running timers
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
    const timeStr = new Date(clockOutTime).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
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
    console.log(`Auto clock-out email sent to ${user.email}`);
  } catch (err) {
    console.error(`Failed to send auto clock-out email to ${user.email}:`, err.message);
  }
}

async function autoClockOut() {
  console.log('[CRON] Running auto clock-out check at', new Date().toLocaleTimeString());

  try {
    // Find all users still clocked in today (no clock_out)
    const [openAttendance] = await db.query(
      `SELECT a.id AS attendance_id, a.user_id, a.clock_in,
              u.first_name, u.last_name, u.email
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.date = CURDATE() AND a.clock_out IS NULL`
    );

    if (openAttendance.length === 0) {
      console.log('[CRON] No users to auto clock-out');
      return;
    }

    console.log(`[CRON] Found ${openAttendance.length} users still clocked in`);

    const now = new Date();
    // Always clock out at 7:00 PM of the attendance date, not current time
    const clockOutTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0); // 7:00 PM today

    for (const record of openAttendance) {
      try {
        // 1. Stop any running task timers
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

        // 2. End any active AFS session
        const [activeAfs] = await db.query(
          `SELECT id, start_time FROM afs_logs WHERE user_id = ? AND end_time IS NULL AND DATE(start_time) = CURDATE()`,
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

        // 3. Calculate total served seconds
        const clockInTime = new Date(record.clock_in);
        const totalServedSeconds = Math.floor((clockOutTime - clockInTime) / 1000);

        // 4. Auto clock-out
        await db.query(
          `UPDATE attendance 
           SET clock_out = ?, total_served_seconds = ?, auto_clock_out = 1
           WHERE id = ?`,
          [clockOutTime, totalServedSeconds, record.attendance_id]
        );

        // 5. Send email notification
        await sendAutoClockOutEmail(record, clockOutTime);

        console.log(`[CRON] Auto clocked-out: ${record.first_name} ${record.last_name}`);
      } catch (userErr) {
        console.error(`[CRON] Error processing user ${record.user_id}:`, userErr.message);
      }
    }

    console.log('[CRON] Auto clock-out complete');
  } catch (err) {
    console.error('[CRON] Auto clock-out error:', err);
  }
}

module.exports = { autoClockOut };
