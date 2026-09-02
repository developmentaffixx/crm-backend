/**
 * Cycle Activation Cron Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs daily at 06:00 IST (00:30 UTC).
 *
 * Finds all service_cycles where:
 *   - status = 'upcoming'
 *   - start_date <= today
 *
 * Promotes each matching cycle to status = 'active' and logs an activity entry
 * against the cycle's project so the team can see when a cycle was auto-activated.
 *
 * Also runs a catch-up check on server startup (after a 15s delay) to handle
 * any missed activations from server downtime.
 */

const db = require('../config/db');

// ─── Core processor ───────────────────────────────────────────────────────────
async function processUpcomingCycleActivations() {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Find all upcoming cycles whose start_date has arrived
    const [cyclestoActivate] = await db.query(
      `SELECT id, project_id, project_service_id, title, start_date
       FROM service_cycles
       WHERE status = 'upcoming' AND start_date <= ?`,
      [today]
    );

    if (cyclestoActivate.length === 0) {
      console.log('[CycleActivationCron] No upcoming cycles to activate today.');
      return;
    }

    console.log(`[CycleActivationCron] Activating ${cyclestoActivate.length} cycle(s)...`);

    for (const cycle of cyclestoActivate) {
      // Promote cycle to active
      await db.query(
        `UPDATE service_cycles SET status = 'active' WHERE id = ?`,
        [cycle.id]
      );

      // Log to project activities (system action — no user, so created_by = NULL)
      await db.query(
        `INSERT INTO project_activities (project_id, type, note, created_by)
         VALUES (?, 'update', ?, NULL)`,
        [cycle.project_id, `${cycle.title} automatically activated (start date: ${cycle.start_date})`]
      );

      console.log(`[CycleActivationCron] Activated: ${cycle.title} (id=${cycle.id}, project_id=${cycle.project_id})`);
    }

    console.log(`[CycleActivationCron] Done. ${cyclestoActivate.length} cycle(s) activated.`);
  } catch (err) {
    console.error('[CycleActivationCron] Error during activation:', err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// Target: 06:00 IST = 00:30 UTC daily
const TARGET_HOUR_UTC   = 0;
const TARGET_MINUTE_UTC = 30;
const MS_PER_DAY        = 24 * 60 * 60 * 1000;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date();

  next.setUTCHours(TARGET_HOUR_UTC, TARGET_MINUTE_UTC, 0, 0);

  // If the target time has already passed today, schedule for tomorrow
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function startCycleActivationCron() {
  console.log('[CycleActivationCron] Scheduler started. Runs daily at 06:00 IST (00:30 UTC).');

  // Catch-up on startup: activate any cycles missed while server was down
  setTimeout(() => {
    console.log('[CycleActivationCron] Running startup catch-up check...');
    processUpcomingCycleActivations();
  }, 15000); // 15s after startup to let DB connections settle

  // Schedule first run at next 00:30 UTC, then repeat every 24 hours
  const msToFirstRun = msUntilNextRun();
  console.log(`[CycleActivationCron] Next scheduled run in ${Math.round(msToFirstRun / 60000)} minute(s).`);

  setTimeout(() => {
    processUpcomingCycleActivations();
    // After the first scheduled run, repeat every 24 hours
    setInterval(processUpcomingCycleActivations, MS_PER_DAY);
  }, msToFirstRun);
}

module.exports = { startCycleActivationCron, processUpcomingCycleActivations };
