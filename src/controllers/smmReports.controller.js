/**
 * SMM Client Monthly Reports
 * Flow: draft -> submitted -> approved (or changes_requested -> submitted again).
 * The final PPTX is only issued once a report is approved; before that a
 * watermarked DRAFT preview can be downloaded for review.
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { buildAnalysis, shiftMonth, monthLabel } = require('../helpers/smmReportAnalysis');
const pptxBuilder = require('../helpers/smmReportPptx');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_INPUT_BYTES = 500 * 1024;
const EDITABLE_BY_TEAM = ['draft', 'changes_requested'];

// ── helpers ──────────────────────────────────────────────────────────────────

const parseJson = (v, fallback = null) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

const canApprove = (req) => !!(req.user.is_admin || req.userCanSmmApprove || req.userCanPcpmApprove);
const canSeeAll = (req) => !!(req.user.is_admin || req.socialAccessLevel >= 2 || canApprove(req));

function shape(row) {
  if (!row) return row;
  return { ...row, inputs: parseJson(row.inputs, {}), analysis: parseJson(row.analysis, null) };
}

async function logHistory(reportId, version, action, remarks, userId) {
  await db.query(
    'INSERT INTO smm_client_report_history (report_id, version, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)',
    [reportId, version, action, remarks || null, userId || null]
  );
}

const REPORT_SELECT = `
  SELECT r.*, p.title AS project_title, p.client_id, l.business_name AS client_name, sv.name AS service_name,
         CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name,
         CONCAT(su.first_name, ' ', su.last_name) AS submitted_by_name,
         CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name
  FROM smm_client_reports r
  LEFT JOIN projects p ON p.id = r.project_id
  LEFT JOIN leads l ON l.id = p.client_id
  LEFT JOIN project_services pss ON pss.id = r.project_service_id
  LEFT JOIN services sv ON sv.id = pss.service_id
  LEFT JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users su ON su.id = r.submitted_by
  LEFT JOIN users au ON au.id = r.approved_by`;

async function loadReport(req, res) {
  const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ?`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ message: 'Report not found' }); return null; }
  const row = rows[0];
  if (!canSeeAll(req) && row.created_by !== req.user.id) {
    res.status(403).json({ message: 'You do not have access to this report' });
    return null;
  }
  return row;
}

async function previousInputs(projectId, serviceId, month) {
  const prevMonth = shiftMonth(month, -1);
  // <=> is null-safe, so reports created before services were tracked still match each other.
  const [rows] = await db.query(
    `SELECT inputs, reporting_month FROM smm_client_reports
     WHERE project_id = ? AND project_service_id <=> ? AND reporting_month = ? AND inputs IS NOT NULL LIMIT 1`,
    [projectId, serviceId || null, prevMonth]
  );
  if (!rows.length) return null;
  const inputs = parseJson(rows[0].inputs, null);
  return inputs ? { ...inputs, reporting_month: prevMonth } : null;
}

function validateInputs(inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return 'inputs must be an object';
  if (Buffer.byteLength(JSON.stringify(inputs)) > MAX_INPUT_BYTES) return 'Report data is too large';
  return null;
}

async function recompute(report, inputs, { forceNarrative = false } = {}) {
  const prev = await previousInputs(report.project_id, report.project_service_id, report.reporting_month);
  const fresh = buildAnalysis({ ...inputs, reporting_month: report.reporting_month }, prev);
  const existing = parseJson(report.analysis, null);
  const keepEdited = !forceNarrative && report.narrative_edited && existing && existing.narrative;
  return {
    facts: fresh.facts,
    narrative: keepEdited ? existing.narrative : fresh.narrative,
    generated_at: fresh.generated_at,
  };
}

// ── logo / image resolution ──────────────────────────────────────────────────

const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };

function downloadBuffer(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? require('https') : require('http');
    const req = client.get(url, { timeout: 8000 }, (resp) => {
      if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location && redirects > 0) {
        return downloadBuffer(resp.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({ buf: Buffer.concat(chunks), type: resp.headers['content-type'] || '' }));
      resp.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function imageDataUri(ref) {
  try {
    if (!ref) return null;
    if (/^https?:\/\//i.test(ref)) {
      const { buf, type } = await downloadBuffer(ref);
      const ext = path.extname(new URL(ref).pathname).toLowerCase();
      const mime = IMG_MIME[ext] || (/png|jpe?g|gif/.test(type) ? type.split(';')[0] : null);
      if (!mime || buf.length < 100) return null;
      return `${mime};base64,${buf.toString('base64')}`;
    }
    const rel = String(ref).replace(/^[\\/]+/, '');
    const roots = [path.join(__dirname, '../../'), path.join(__dirname, '../../uploads'), process.env.UPLOADS_DIR || ''].filter(Boolean);
    for (const root of roots) {
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(path.resolve(root))) continue; // stay inside the root
      if (!fs.existsSync(abs)) continue;
      const mime = IMG_MIME[path.extname(abs).toLowerCase()];
      if (!mime) return null;
      return `${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
    }
  } catch (e) { /* logo is optional */ }
  return null;
}

async function loadBranding(clientId) {
  let affixxLogo = null; let clientLogo = null;
  try {
    const [co] = await db.query('SELECT logo_url FROM company_settings LIMIT 1');
    affixxLogo = await imageDataUri(co[0] && co[0].logo_url);
  } catch (e) { /* ignore */ }
  if (!affixxLogo) affixxLogo = await imageDataUri('frontend-logo.png');
  try {
    if (clientId) {
      const [cl] = await db.query('SELECT logo_file_path FROM client_onboarding_b WHERE client_id = ? LIMIT 1', [clientId]);
      clientLogo = await imageDataUri(cl[0] && cl[0].logo_file_path);
    }
  } catch (e) { /* ignore */ }
  return { affixxLogo, clientLogo };
}

// ── endpoints ────────────────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const { project_id, status, month } = req.query;
    const where = ['1=1']; const params = [];
    if (project_id) { where.push('r.project_id = ?'); params.push(Number(project_id)); }
    if (req.query.project_service_id) { where.push('r.project_service_id = ?'); params.push(Number(req.query.project_service_id)); }
    if (status) { where.push('r.status = ?'); params.push(status); }
    if (month && MONTH_RE.test(month)) { where.push('r.reporting_month = ?'); params.push(month); }
    if (!canSeeAll(req)) { where.push('r.created_by = ?'); params.push(req.user.id); }
    const [rows] = await db.query(
      `SELECT r.id, r.project_id, r.project_service_id, r.reporting_month, r.status, r.version, r.created_at, r.updated_at,
              r.submitted_at, r.approved_at, p.title AS project_title, l.business_name AS client_name,
              sv.name AS service_name, CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name
       FROM smm_client_reports r
       LEFT JOIN projects p ON p.id = r.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN project_services pss ON pss.id = r.project_service_id
       LEFT JOIN services sv ON sv.id = pss.service_id
       LEFT JOIN users cu ON cu.id = r.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY r.reporting_month DESC, r.updated_at DESC LIMIT 200`,
      params
    );
    return res.json({ reports: rows });
  } catch (err) {
    console.error('SMM report list error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

// Services attached to a project, for the Project > Service dropdown.
exports.projectServices = async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    if (!projectId) return res.status(400).json({ message: 'project_id is required' });
    const [rows] = await db.query(
      `SELECT ps.id AS project_service_id, ps.status, s.id AS service_id, s.name AS service_name
       FROM project_services ps JOIN services s ON s.id = ps.service_id
       WHERE ps.project_id = ? ORDER BY s.name`,
      [projectId]
    );
    return res.json({ services: rows });
  } catch (err) {
    console.error('SMM report services error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

// Starting values for a new report: previous month's platforms and deliverable types.
exports.prefill = async (req, res) => {
  try {
    const { project_id, month } = req.query;
    const serviceId = req.query.project_service_id ? Number(req.query.project_service_id) : null;
    if (!project_id || !MONTH_RE.test(month || '')) return res.status(400).json({ message: 'project_id and month (YYYY-MM) are required' });
    const prev = await previousInputs(Number(project_id), serviceId, month);
    const [exists] = await db.query('SELECT id FROM smm_client_reports WHERE project_id = ? AND project_service_id <=> ? AND reporting_month = ?', [Number(project_id), serviceId, month]);
    return res.json({
      existing_report_id: exists[0] ? exists[0].id : null,
      has_previous: !!prev,
      previous_month: prev ? prev.reporting_month : null,
      platforms: prev ? prev.platforms || [] : [],
      deliverable_types: prev ? (prev.deliverables || []).map(d => d.type).filter(Boolean) : [],
      ads_enabled: prev && prev.ads ? !!prev.ads.enabled : false,
    });
  } catch (err) {
    console.error('SMM report prefill error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.create = async (req, res) => {
  try {
    const { project_id, reporting_month } = req.body;
    const serviceId = Number(req.body.project_service_id);
    const inputs = req.body.inputs || {};
    if (!project_id || !serviceId || !MONTH_RE.test(reporting_month || '')) return res.status(400).json({ message: 'Project, service and reporting month (YYYY-MM) are required' });
    const bad = validateInputs(inputs);
    if (bad) return res.status(400).json({ message: bad });

    const [proj] = await db.query('SELECT id FROM projects WHERE id = ? AND deleted = 0', [Number(project_id)]);
    if (!proj.length) return res.status(404).json({ message: 'Project not found' });
    const [svc] = await db.query('SELECT id FROM project_services WHERE id = ? AND project_id = ?', [serviceId, Number(project_id)]);
    if (!svc.length) return res.status(400).json({ message: 'That service does not belong to the selected project' });

    const [dup] = await db.query('SELECT id FROM smm_client_reports WHERE project_id = ? AND project_service_id = ? AND reporting_month = ?', [Number(project_id), serviceId, reporting_month]);
    if (dup.length) return res.status(409).json({ message: 'A report already exists for this project, service and month', report_id: dup[0].id });

    const analysis = await recompute({ project_id: Number(project_id), project_service_id: serviceId, reporting_month, narrative_edited: 0, analysis: null }, inputs);
    const [result] = await db.query(
      'INSERT INTO smm_client_reports (project_id, project_service_id, reporting_month, status, version, inputs, analysis, created_by) VALUES (?, ?, ?, "draft", 1, ?, ?, ?)',
      [Number(project_id), serviceId, reporting_month, JSON.stringify(inputs), JSON.stringify(analysis), req.user.id]
    );
    await logHistory(result.insertId, 1, 'created', null, req.user.id);
    const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ?`, [result.insertId]);
    return res.status(201).json(shape(rows[0]));
  } catch (err) {
    console.error('SMM report create error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.getOne = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    const [history] = await db.query(
      `SELECT h.*, CONCAT(u.first_name, ' ', u.last_name) AS acted_by_name
       FROM smm_client_report_history h LEFT JOIN users u ON u.id = h.acted_by
       WHERE h.report_id = ? ORDER BY h.id DESC`,
      [row.id]
    );
    return res.json({ ...shape(row), history, can_approve: canApprove(req) });
  } catch (err) {
    console.error('SMM report get error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

function assertEditable(req, res, row) {
  if (row.status === 'approved') { res.status(409).json({ message: 'Approved reports are locked. Reopen the report to edit it.' }); return false; }
  if (row.status === 'submitted' && !canApprove(req)) { res.status(403).json({ message: 'Only a reviewer can edit a submitted report' }); return false; }
  if (EDITABLE_BY_TEAM.includes(row.status) && !canSeeAll(req) && row.created_by !== req.user.id) { res.status(403).json({ message: 'Not allowed' }); return false; }
  return true;
}

exports.updateInputs = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!assertEditable(req, res, row)) return res;
    const inputs = req.body.inputs;
    const bad = validateInputs(inputs);
    if (bad) return res.status(400).json({ message: bad });

    const analysis = await recompute(row, inputs);
    await db.query('UPDATE smm_client_reports SET inputs = ?, analysis = ? WHERE id = ?', [JSON.stringify(inputs), JSON.stringify(analysis), row.id]);
    if (row.status === 'submitted') await logHistory(row.id, row.version, 'reviewer_edit', 'Metrics corrected during review', req.user.id);
    const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ?`, [row.id]);
    return res.json(shape(rows[0]));
  } catch (err) {
    console.error('SMM report update error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.updateNarrative = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!assertEditable(req, res, row)) return res;
    const narrative = req.body.narrative;
    if (!narrative || typeof narrative !== 'object' || Array.isArray(narrative)) return res.status(400).json({ message: 'narrative must be an object' });
    const analysis = parseJson(row.analysis, {}) || {};
    // Only known narrative keys may be edited; unknown keys are ignored.
    const merged = { ...(analysis.narrative || {}) };
    Object.keys(merged).forEach((k) => { if (narrative[k] !== undefined) merged[k] = narrative[k]; });
    analysis.narrative = merged;
    await db.query('UPDATE smm_client_reports SET analysis = ?, narrative_edited = 1 WHERE id = ?', [JSON.stringify(analysis), row.id]);
    if (row.status === 'submitted') await logHistory(row.id, row.version, 'reviewer_edit', 'Report text edited during review', req.user.id);
    const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ?`, [row.id]);
    return res.json(shape(rows[0]));
  } catch (err) {
    console.error('SMM report narrative error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.regenerate = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!assertEditable(req, res, row)) return res;
    const analysis = await recompute(row, parseJson(row.inputs, {}), { forceNarrative: true });
    await db.query('UPDATE smm_client_reports SET analysis = ?, narrative_edited = 0 WHERE id = ?', [JSON.stringify(analysis), row.id]);
    const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ?`, [row.id]);
    return res.json(shape(rows[0]));
  } catch (err) {
    console.error('SMM report regenerate error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

// Optional: Gemini rewrites the wording only. Output is rejected if it introduces any number
// that was not in the source text, so it cannot add unsupported figures.
const POLISH_KEYS = ['overview', 'deliverables_summary', 'performance_note', 'platform_note', 'audience_note', 'content_notes', 'ads_note',
  'worked', 'not_worked', 'improvements', 'attention', 'rec_content', 'rec_formats', 'rec_campaigns', 'rec_audience', 'rec_ads',
  'plan_direction', 'plan_priorities', 'plan_actions'];
const numbersIn = (s) => new Set((String(s).match(/\d[\d,]*\.?\d*/g) || []).map(n => n.replace(/,/g, '').replace(/\.$/, '')));

exports.polish = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!assertEditable(req, res, row)) return res;
    const analysis = parseJson(row.analysis, null);
    if (!analysis || !analysis.narrative) return res.status(400).json({ message: 'No analysis to polish' });

    const source = {};
    POLISH_KEYS.forEach((k) => { if (analysis.narrative[k] !== undefined) source[k] = analysis.narrative[k]; });

    const prompt = `You are editing a monthly social media performance report for a client of a marketing agency.
Rewrite every string below in clear, professional, client-friendly language.
Strict rules:
- Return ONLY valid JSON with exactly the same keys and the same array lengths as the input.
- Do not add, remove, change or invent any number, percentage, name or fact. Use only what is in the input.
- Do not add claims about results, causes or guarantees that are not in the input.
- Keep each string concise.

INPUT:
${JSON.stringify(source)}`;

    const { generateWithGemini } = require('../config/gemini');
    let text = (await generateWithGemini(prompt)).trim();
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let out;
    try { out = JSON.parse(text); } catch { return res.status(502).json({ message: 'AI returned an invalid format. The original text was kept.' }); }

    const allowed = numbersIn(JSON.stringify(source));
    const merged = { ...analysis.narrative };
    for (const k of Object.keys(source)) {
      const a = source[k]; const b = out[k];
      if (typeof a === 'string' && typeof b === 'string') {
        if ([...numbersIn(b)].some(n => !allowed.has(n))) return res.status(422).json({ message: `AI output added figures not present in the data (${k}). The original text was kept.` });
        merged[k] = b;
      } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && b.every(x => typeof x === 'string')) {
        if (b.some(x => [...numbersIn(x)].some(n => !allowed.has(n)))) return res.status(422).json({ message: `AI output added figures not present in the data (${k}). The original text was kept.` });
        merged[k] = b;
      }
    }
    analysis.narrative = merged;
    await db.query('UPDATE smm_client_reports SET analysis = ?, narrative_edited = 1 WHERE id = ?', [JSON.stringify(analysis), row.id]);
    const [rows] = await db.query(`${REPORT_SELECT} WHERE r.id = ?`, [row.id]);
    return res.json(shape(rows[0]));
  } catch (err) {
    console.error('SMM report polish error:', err.message);
    return res.status(500).json({ message: 'AI wording step failed: ' + err.message });
  }
};

exports.submit = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!EDITABLE_BY_TEAM.includes(row.status)) return res.status(409).json({ message: `Cannot submit a report that is ${row.status}` });
    const inputs = parseJson(row.inputs, {});
    const hasMetrics = Object.values(inputs.platform_metrics || {}).some(p => p && Object.values(p).some(v => v !== '' && v !== null && v !== undefined && !Array.isArray(v)));
    if (!hasMetrics && !(inputs.deliverables || []).length) return res.status(400).json({ message: 'Enter deliverables or platform metrics before submitting' });
    await db.query('UPDATE smm_client_reports SET status = "submitted", submitted_by = ?, submitted_at = NOW(), review_notes = NULL WHERE id = ?', [req.user.id, row.id]);
    await logHistory(row.id, row.version, 'submitted', req.body.remarks, req.user.id);
    return res.json({ message: 'Report submitted for review' });
  } catch (err) {
    console.error('SMM report submit error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.requestChanges = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!canApprove(req)) return res.status(403).json({ message: 'You do not have review permission' });
    if (row.status !== 'submitted') return res.status(409).json({ message: 'Only submitted reports can be sent back' });
    const remarks = (req.body.remarks || '').trim();
    if (!remarks) return res.status(400).json({ message: 'Please say what needs to change' });
    await db.query('UPDATE smm_client_reports SET status = "changes_requested", review_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?', [remarks, req.user.id, row.id]);
    await logHistory(row.id, row.version, 'changes_requested', remarks, req.user.id);
    return res.json({ message: 'Report sent back for changes' });
  } catch (err) {
    console.error('SMM report request-changes error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.approve = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!canApprove(req)) return res.status(403).json({ message: 'You do not have approval permission' });
    if (row.status !== 'submitted') return res.status(409).json({ message: 'Only submitted reports can be approved' });
    if (!req.user.is_admin && row.submitted_by === req.user.id) return res.status(403).json({ message: 'A report cannot be approved by the person who submitted it' });
    await db.query('UPDATE smm_client_reports SET status = "approved", approved_by = ?, approved_at = NOW(), reviewed_by = ?, reviewed_at = NOW() WHERE id = ?', [req.user.id, req.user.id, row.id]);
    await logHistory(row.id, row.version, 'approved', req.body.remarks, req.user.id);
    return res.json({ message: 'Report approved. The final PowerPoint is now available.' });
  } catch (err) {
    console.error('SMM report approve error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

// Reopening an approved report starts a new version that must be approved again.
exports.reopen = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (!canApprove(req)) return res.status(403).json({ message: 'You do not have approval permission' });
    if (row.status !== 'approved') return res.status(409).json({ message: 'Only approved reports can be reopened' });
    const remarks = (req.body.remarks || '').trim();
    if (!remarks) return res.status(400).json({ message: 'A reason is required to reopen an approved report' });
    const version = row.version + 1;
    await db.query('UPDATE smm_client_reports SET status = "draft", version = ?, approved_by = NULL, approved_at = NULL WHERE id = ?', [version, row.id]);
    await logHistory(row.id, version, 'reopened', remarks, req.user.id);
    return res.json({ message: `Report reopened as version ${version}` });
  } catch (err) {
    console.error('SMM report reopen error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

exports.remove = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    if (row.status === 'approved') return res.status(409).json({ message: 'Approved reports cannot be deleted' });
    if (!req.user.is_admin && row.created_by !== req.user.id) return res.status(403).json({ message: 'Only the creator or an admin can delete this report' });
    await db.query('DELETE FROM smm_client_report_history WHERE report_id = ?', [row.id]);
    await db.query('DELETE FROM smm_client_reports WHERE id = ?', [row.id]);
    return res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('SMM report delete error:', err);
    return res.status(500).json({ message: 'Server error', detail: (err.code || "") + " " + (err.sqlMessage || err.message) });
  }
};

// GET /:id/pptx            -> final deck (approved reports only)
// GET /:id/pptx?preview=1  -> watermarked draft for review
exports.exportPptx = async (req, res) => {
  try {
    const row = await loadReport(req, res);
    if (!row) return res;
    const preview = req.query.preview === '1';
    if (row.status !== 'approved' && !preview) return res.status(403).json({ message: 'The final PowerPoint is available only after approval. Use the draft preview while reviewing.' });

    const analysis = parseJson(row.analysis, null);
    const inputs = parseJson(row.inputs, {});
    if (!analysis) return res.status(400).json({ message: 'Report has no analysis yet' });

    const branding = await loadBranding(row.client_id);
    const buf = await pptxBuilder.toBuffer({
      meta: {
        clientName: row.client_name || row.project_title || 'Client',
        month: row.reporting_month,
        nextMonthLabel: monthLabel(shiftMonth(row.reporting_month, 1)),
        platforms: inputs.platforms || [],
        ...branding,
      },
      facts: analysis.facts,
      narrative: analysis.narrative,
      draft: row.status !== 'approved',
    });

    const safe = `${row.client_name || row.project_title || 'Report'}_${row.reporting_month}${row.status === 'approved' ? '' : '_DRAFT'}.pptx`.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    if (row.status === 'approved') await logHistory(row.id, row.version, 'downloaded', null, req.user.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    return res.send(buf);
  } catch (err) {
    console.error('SMM report pptx error:', err);
    return res.status(500).json({ message: 'Failed to generate PowerPoint: ' + err.message });
  }
};
