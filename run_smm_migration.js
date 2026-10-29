// One-off runner for migration_smm_two_stage_approval.sql
// Uses the app's own DB pool/credentials. Safe to re-run.
const fs = require('fs');
const path = require('path');
const db = require('./src/config/db');

(async () => {
  const file = path.join(__dirname, 'database', 'migration_smm_two_stage_approval.sql');
  const sql = fs.readFileSync(file, 'utf8');

  // Split on semicolons at end of line. The guarded ALTERs use PREPARE/EXECUTE
  // which are individual statements, so a naive split works here because each
  // statement ends with ';' on its own.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !/^--/.test(s) && s.toUpperCase() !== 'USE CRM_TASK_MODULE');

  const conn = await db.getConnection();
  try {
    for (const stmt of statements) {
      if (/^USE\s/i.test(stmt)) continue;
      try {
        const [res] = await conn.query(stmt);
        if (Array.isArray(res) && res[0] && res[0].status) {
          console.log('→', res[0].status);
        }
      } catch (e) {
        // Tolerate "already exists" style errors so the script stays idempotent.
        if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(e.code)) {
          console.log('  (skip, already applied):', e.sqlMessage);
        } else {
          console.error('✗ Statement failed:', e.code, e.sqlMessage);
          console.error('   SQL:', stmt.slice(0, 120));
          throw e;
        }
      }
    }
    console.log('✓ Migration applied successfully.');
  } finally {
    conn.release();
    await db.end();
  }
})().catch(err => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
