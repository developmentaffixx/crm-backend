/**
 * Recurring Expenses Cron Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs every hour. Checks for recurring expenses where next_run_date <= today
 * and status = 'active'. For each match, creates a new expense entry and
 * advances the next_run_date.
 *
 * Also handles catch-up: if the app was down and missed a run date,
 * it creates all missed entries.
 */

const db = require('../config/db');
const { calculateNextRunDate } = require('../controllers/recurringExpenses.controller');

async function generateExpenseIdCode(expenseDate) {
  const expDate = new Date(expenseDate);
  const eyy = String(expDate.getFullYear()).slice(-2);
  const emm = String(expDate.getMonth() + 1).padStart(2, '0');
  const expPrefix = `EXP-${eyy}${emm}`;
  const [lastExp] = await db.query(
    `SELECT expense_id_code FROM expenses WHERE expense_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${expPrefix}-%`]
  );
  let expSeq = 1;
  if (lastExp.length > 0 && lastExp[0].expense_id_code) {
    const parts = lastExp[0].expense_id_code.split('-');
    expSeq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `${expPrefix}-${String(expSeq).padStart(3, '0')}`;
}

async function processRecurringExpenses() {
  const today = new Date().toISOString().split('T')[0];

  console.log(`[RecurringExpensesCron] Running for date: ${today}`);

  try {
    // Find all active recurring expenses where next_run_date <= today
    const [rules] = await db.query(
      `SELECT * FROM recurring_expenses
       WHERE status = 'active' AND deleted = 0 AND next_run_date <= ?`,
      [today]
    );

    if (rules.length === 0) {
      console.log('[RecurringExpensesCron] No recurring expenses due today.');
      return;
    }

    console.log(`[RecurringExpensesCron] Found ${rules.length} recurring expense(s) to process.`);

    for (const rule of rules) {
      try {
        // Create expense entries for all missed dates (catch-up)
        let currentRunDate = rule.next_run_date instanceof Date
          ? rule.next_run_date.toISOString().split('T')[0]
          : String(rule.next_run_date).split('T')[0];

        let entriesCreated = 0;

        while (currentRunDate <= today) {
          // Check if end_date has passed
          if (rule.end_date) {
            const endDateStr = rule.end_date instanceof Date
              ? rule.end_date.toISOString().split('T')[0]
              : String(rule.end_date).split('T')[0];

            if (currentRunDate > endDateStr) {
              // Mark as completed
              await db.query(
                'UPDATE recurring_expenses SET status = ? WHERE id = ?',
                ['completed', rule.id]
              );
              console.log(`[RecurringExpensesCron] Rule ${rule.id} (${rule.title}) completed — end date reached.`);
              break;
            }
          }

          // Generate expense ID code
          const expense_id_code = await generateExpenseIdCode(currentRunDate);

          // Create the expense entry
          await db.query(
            `INSERT INTO expenses
              (expense_id_code, title, expense_date, expense_type, client_id, project_id,
               category, vendor_name, amount, payment_mode, bill_copy,
               recurring_expense_id, is_auto_generated, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)`,
            [
              expense_id_code,
              rule.title,
              currentRunDate,
              rule.expense_type,
              rule.client_id || null,
              rule.project_id || null,
              rule.other_category || rule.category,
              rule.vendor_name,
              rule.amount,
              rule.payment_mode,
              rule.id,
              rule.created_by
            ]
          );

          entriesCreated++;

          // Calculate next run date
          currentRunDate = calculateNextRunDate(currentRunDate, rule.frequency, rule.repeat_day);
        }

        // Update the rule's next_run_date
        // Check if the new next_run_date exceeds end_date
        if (rule.end_date) {
          const endDateStr = rule.end_date instanceof Date
            ? rule.end_date.toISOString().split('T')[0]
            : String(rule.end_date).split('T')[0];

          if (currentRunDate > endDateStr) {
            await db.query(
              'UPDATE recurring_expenses SET status = ?, next_run_date = ? WHERE id = ?',
              ['completed', currentRunDate, rule.id]
            );
            console.log(`[RecurringExpensesCron] Rule ${rule.id} (${rule.title}) completed after creating ${entriesCreated} entries.`);
          } else {
            await db.query(
              'UPDATE recurring_expenses SET next_run_date = ? WHERE id = ?',
              [currentRunDate, rule.id]
            );
          }
        } else {
          await db.query(
            'UPDATE recurring_expenses SET next_run_date = ? WHERE id = ?',
            [currentRunDate, rule.id]
          );
        }

        if (entriesCreated > 0) {
          console.log(`[RecurringExpensesCron] Rule ${rule.id} (${rule.title}): Created ${entriesCreated} expense(s). Next run: ${currentRunDate}`);
        }
      } catch (ruleErr) {
        console.error(`[RecurringExpensesCron] Error processing rule ${rule.id}:`, ruleErr.message);
      }
    }

    console.log('[RecurringExpensesCron] Done.');
  } catch (err) {
    console.error('[RecurringExpensesCron] Fatal error:', err);
  }
}

// ─── Scheduler: runs every hour ───────────────────────────────────────────────
function startRecurringExpensesCron() {
  console.log('[RecurringExpensesCron] Scheduler started. Checks every hour for due recurring expenses.');

  // Run immediately on startup to catch any missed entries
  setTimeout(() => processRecurringExpenses(), 10000); // 10s delay after startup

  // Then run every hour
  setInterval(processRecurringExpenses, 60 * 60 * 1000);
}

module.exports = { startRecurringExpensesCron, processRecurringExpenses };
