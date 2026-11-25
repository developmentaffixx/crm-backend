/**
 * SMM Client Monthly Reports - schema bootstrap.
 * Created without foreign keys (same convention as ensureTeamTables) because
 * production schemas differ in id signedness.
 */
const db = require('../config/db');

async function ensureSmmReportSchema() {
  await db.query(`CREATE TABLE IF NOT EXISTS smm_client_reports (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id INT UNSIGNED NOT NULL,
    project_service_id INT UNSIGNED NULL,
    reporting_month CHAR(7) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    version INT NOT NULL DEFAULT 1,
    inputs LONGTEXT NULL,
    analysis LONGTEXT NULL,
    narrative_edited TINYINT(1) NOT NULL DEFAULT 0,
    review_notes TEXT NULL,
    created_by INT UNSIGNED NULL,
    submitted_by INT UNSIGNED NULL,
    submitted_at DATETIME NULL,
    reviewed_by INT UNSIGNED NULL,
    reviewed_at DATETIME NULL,
    approved_by INT UNSIGNED NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_service_month (project_id, project_service_id, reporting_month),
    INDEX idx_status (status)
  )`);

  // Upgrade tables created before reports were tied to a service.
  const [cols] = await db.query("SHOW COLUMNS FROM smm_client_reports LIKE 'project_service_id'");
  if (!cols.length) await db.query('ALTER TABLE smm_client_reports ADD COLUMN project_service_id INT UNSIGNED NULL AFTER project_id');
  const [newIdx] = await db.query("SHOW INDEX FROM smm_client_reports WHERE Key_name = 'uq_project_service_month'");
  if (!newIdx.length) await db.query('ALTER TABLE smm_client_reports ADD UNIQUE KEY uq_project_service_month (project_id, project_service_id, reporting_month)');
  const [oldIdx] = await db.query("SHOW INDEX FROM smm_client_reports WHERE Key_name = 'uq_project_month'");
  if (oldIdx.length) await db.query('ALTER TABLE smm_client_reports DROP INDEX uq_project_month');

  await db.query(`CREATE TABLE IF NOT EXISTS smm_client_report_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    report_id INT UNSIGNED NOT NULL,
    version INT NOT NULL DEFAULT 1,
    action VARCHAR(30) NOT NULL,
    remarks TEXT NULL,
    acted_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_report (report_id)
  )`);
}

// Runs once per process; a failed attempt is retried on the next request.
let ready = null;
function ensureSmmReportSchemaOnce() {
  if (!ready) ready = ensureSmmReportSchema().catch((err) => { ready = null; throw err; });
  return ready;
}

module.exports = { ensureSmmReportSchema, ensureSmmReportSchemaOnce };
