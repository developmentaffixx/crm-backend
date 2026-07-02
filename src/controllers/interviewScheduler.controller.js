const db   = require('../config/db');
const https = require('https');
const http  = require('http');

// ── GET /api/interview-scheduler/candidates ───────────────────────────────────
exports.listCandidates = async (req, res) => {
  try {
    const { search, status, source } = req.query;

    let sql = `
      SELECT ic.*
      FROM interview_candidates ic
      WHERE ic.deleted = 0
    `;
    const params = [];

    if (search) {
      sql += ` AND (ic.full_name LIKE ? OR ic.email LIKE ? OR ic.contact_number LIKE ? OR ic.position_applied LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (status === 'waiting') {
      sql += ` AND ic.status = 'on_hold'`;
    } else if (status === 'pipeline') {
      sql += ` AND ic.status IN ('new', 'in_process')`;
    } else if (status) {
      sql += ` AND ic.status = ?`;
      params.push(status);
    }
    if (source) {
      sql += ` AND ic.source = ?`;
      params.push(source);
    }

    sql += ` ORDER BY ic.created_at DESC`;

    const [rows] = await db.query(sql, params);
    return res.json({ candidates: rows });
  } catch (err) {
    console.error('interview listCandidates error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/candidates/:id ───────────────────────────────
exports.getCandidate = async (req, res) => {
  try {
    const { id } = req.params;

    const [candidates] = await db.query(
      `SELECT * FROM interview_candidates WHERE id = ? AND deleted = 0`,
      [id]
    );
    if (!candidates.length) return res.status(404).json({ message: 'Candidate not found' });

    const [rounds] = await db.query(
      `SELECT ir.*, CONCAT(u.first_name, ' ', u.last_name) AS interviewer_name
       FROM interview_rounds ir
       LEFT JOIN users u ON u.id = ir.interviewer_id
       WHERE ir.candidate_id = ? AND ir.deleted = 0
       ORDER BY ir.round_number ASC`,
      [id]
    );

    const candidate = candidates[0];
    candidate.siblings  = candidate.siblings  ? (typeof candidate.siblings  === 'string' ? JSON.parse(candidate.siblings)  : candidate.siblings)  : [];
    candidate.referrals = candidate.referrals ? (typeof candidate.referrals === 'string' ? JSON.parse(candidate.referrals) : candidate.referrals) : [];

    // Fetch questions for this candidate's position
    const [questions] = await db.query(
      `SELECT * FROM interview_question_bank WHERE position_name = ? ORDER BY order_no ASC`,
      [candidate.position_applied]
    );

    return res.json({ candidate, rounds, questions });
  } catch (err) {
    console.error('interview getCandidate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/interview-scheduler/applications (public — joinus form) ─────────
exports.submitApplication = async (req, res) => {
  try {
    const d = req.body;

    if (!d.full_name?.trim() || !d.position_applied?.trim()) {
      return res.status(400).json({ message: 'Name and position are required' });
    }

    const siblingsJson  = d.siblings  && Array.isArray(d.siblings)  && d.siblings.length  ? JSON.stringify(d.siblings)  : null;
    const referralsJson = d.referrals && Array.isArray(d.referrals) && d.referrals.length ? JSON.stringify(d.referrals) : null;

    const [result] = await db.query(
      `INSERT INTO interview_candidates (
        full_name, email, contact_number, date_of_birth, gender, address,
        nationality, marital_status, husband_name, husband_occupation,
        father_name, father_occupation, mother_name, mother_occupation,
        siblings, mode_of_transport, position_applied, expected_salary, last_salary,
        immediate_joining, available_start_date, highest_qualification,
        university, year_of_passing, additional_certs, resume_path,
        experience_level, total_experience_years, previous_company,
        last_designation, employment_from, employment_to, reason_for_leaving,
        comfortable_relocating, has_medical_condition, medical_condition_note,
        referrals, source, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      [
        d.full_name?.trim(),
        d.email?.trim() || null,
        d.contact_number?.trim() || null,
        d.date_of_birth || null,
        d.gender || null,
        d.address || null,
        d.nationality || null,
        d.marital_status || null,
        d.husband_name || null,
        d.husband_occupation || null,
        d.father_name || null,
        d.father_occupation || null,
        d.mother_name || null,
        d.mother_occupation || null,
        siblingsJson,
        d.mode_of_transport || null,
        d.position_applied?.trim(),
        d.expected_salary || null,
        d.last_salary || null,
        d.immediate_joining || null,
        d.available_start_date || null,
        d.highest_qualification || null,
        d.university || null,
        d.year_of_passing || null,
        d.additional_certs || null,
        d.resume_path || null,
        d.experience_level || null,
        d.total_experience_years || null,
        d.previous_company || null,
        d.last_designation || null,
        d.employment_from || null,
        d.employment_to || null,
        d.reason_for_leaving || null,
        d.comfortable_relocating ? 1 : 0,
        d.has_medical_condition ? 1 : 0,
        d.medical_condition_note || null,
        referralsJson,
        d.source || 'joinus_form',
      ]
    );

    return res.status(201).json({ success: true, reference_id: result.insertId, message: 'Submission received.' });
  } catch (err) {
    console.error('interview submitApplication error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── PATCH /api/interview-scheduler/candidates/:id/status ──────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['new', 'in_process', 'selected', 'rejected', 'on_hold'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    await db.query(
      `UPDATE interview_candidates SET status = ? WHERE id = ? AND deleted = 0`,
      [status, id]
    );

    return res.json({ message: 'Status updated' });
  } catch (err) {
    console.error('interview updateStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/interview-scheduler/candidates/:id/rounds ───────────────────────
exports.createRound = async (req, res) => {
  try {
    const { id } = req.params;
    const { round_name, interviewer_id, scheduled_date, scheduled_time, mode } = req.body;

    // Get next round number
    const [existing] = await db.query(
      `SELECT MAX(round_number) AS max_round FROM interview_rounds WHERE candidate_id = ? AND deleted = 0`,
      [id]
    );
    const nextRound = (existing[0]?.max_round || 0) + 1;

    const [result] = await db.query(
      `INSERT INTO interview_rounds (candidate_id, round_number, round_name, interviewer_id, scheduled_date, scheduled_time, mode, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, nextRound, round_name || `Round ${nextRound}`, interviewer_id || null, scheduled_date || null, scheduled_time || null, mode || 'in_person', req.user.id]
    );

    // Update candidate status to in_process
    await db.query(
      `UPDATE interview_candidates SET status = 'in_process' WHERE id = ? AND status = 'new'`,
      [id]
    );

    return res.status(201).json({ message: 'Round scheduled', id: result.insertId, round_number: nextRound });
  } catch (err) {
    console.error('interview createRound error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── PATCH /api/interview-scheduler/rounds/:id ─────────────────────────────────
exports.updateRound = async (req, res) => {
  try {
    const { id } = req.params;
    const { verdict, remarks, rating, scheduled_date, scheduled_time, interviewer_id, status } = req.body;

    const fields = [];
    const params = [];

    if (scheduled_date  !== undefined) { fields.push('scheduled_date = ?');  params.push(scheduled_date); }
    if (scheduled_time  !== undefined) { fields.push('scheduled_time = ?');  params.push(scheduled_time); }
    if (interviewer_id  !== undefined) { fields.push('interviewer_id = ?');  params.push(interviewer_id); }
    if (remarks         !== undefined) { fields.push('remarks = ?');         params.push(remarks); }
    if (rating          !== undefined) { fields.push('rating = ?');          params.push(rating); }
    if (status          !== undefined) { fields.push('status = ?');          params.push(status); }

    if (verdict !== undefined) {
      fields.push('verdict = ?');
      params.push(verdict);
      fields.push('completed_at = NOW()');
      fields.push('status = ?');
      params.push('completed');
    }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

    params.push(id);
    await db.query(`UPDATE interview_rounds SET ${fields.join(', ')} WHERE id = ? AND deleted = 0`, params);

    // Update candidate status based on verdict
    if (verdict) {
      const [[round]] = await db.query(`SELECT candidate_id FROM interview_rounds WHERE id = ?`, [id]);
      if (round) {
        if (verdict === 'rejected') {
          await db.query(`UPDATE interview_candidates SET status = 'rejected' WHERE id = ?`, [round.candidate_id]);
        } else if (verdict === 'selected') {
          await db.query(`UPDATE interview_candidates SET status = 'selected' WHERE id = ?`, [round.candidate_id]);
        } else if (verdict === 'on_hold') {
          await db.query(`UPDATE interview_candidates SET status = 'on_hold' WHERE id = ?`, [round.candidate_id]);
        }
        // verdict === 'pass' → candidate stays in_process, next round will be scheduled
      }
    }

    return res.json({ message: 'Round updated' });
  } catch (err) {
    console.error('interview updateRound error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/schedule ─────────────────────────────────────
exports.getSchedule = async (req, res) => {
  try {
    const { from, to } = req.query;

    let sql = `
      SELECT
        ir.*,
        ic.full_name AS candidate_name,
        ic.position_applied,
        CONCAT(u.first_name, ' ', u.last_name) AS interviewer_name
      FROM interview_rounds ir
      JOIN interview_candidates ic ON ic.id = ir.candidate_id
      LEFT JOIN users u ON u.id = ir.interviewer_id
      WHERE ir.deleted = 0 AND ir.status = 'scheduled'
    `;
    const params = [];

    if (from) { sql += ` AND ir.scheduled_date >= ?`; params.push(from); }
    if (to)   { sql += ` AND ir.scheduled_date <= ?`; params.push(to); }

    sql += ` ORDER BY ir.scheduled_date ASC, ir.scheduled_time ASC`;

    const [rows] = await db.query(sql, params);
    return res.json({ schedule: rows });
  } catch (err) {
    console.error('interview getSchedule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/today ────────────────────────────────────────
exports.getToday = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await db.query(
      `SELECT
        ir.*,
        ic.full_name AS candidate_name,
        ic.contact_number,
        ic.position_applied,
        ic.source,
        CONCAT(u.first_name, ' ', u.last_name) AS interviewer_name
       FROM interview_rounds ir
       JOIN interview_candidates ic ON ic.id = ir.candidate_id
       LEFT JOIN users u ON u.id = ir.interviewer_id
       WHERE ir.deleted = 0 AND ir.scheduled_date = ?
       ORDER BY ir.scheduled_time ASC`,
      [today]
    );
    return res.json({ interviews: rows });
  } catch (err) {
    console.error('interview getToday error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/stats ────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [[stats]] = await db.query(`
      SELECT
        CAST(COUNT(*) AS UNSIGNED)                        AS total,
        CAST(SUM(status = 'new') AS UNSIGNED)             AS new_count,
        CAST(SUM(status = 'in_process') AS UNSIGNED)      AS in_process_count,
        CAST(SUM(status = 'selected') AS UNSIGNED)        AS selected_count,
        CAST(SUM(status = 'rejected') AS UNSIGNED)        AS rejected_count,
        CAST(SUM(status = 'on_hold') AS UNSIGNED)         AS on_hold_count
      FROM interview_candidates
      WHERE deleted = 0
    `);

    const [[todayCount]] = await db.query(`
      SELECT CAST(COUNT(*) AS UNSIGNED) AS today_count
      FROM interview_rounds
      WHERE deleted = 0 AND scheduled_date = CURDATE()
    `);

    return res.json({
      total:           Number(stats.total          || 0),
      new_count:       Number(stats.new_count       || 0),
      in_process_count: Number(stats.in_process_count || 0),
      selected_count:  Number(stats.selected_count  || 0),
      rejected_count:  Number(stats.rejected_count  || 0),
      on_hold_count:   Number(stats.on_hold_count   || 0),
      today_count:     Number(todayCount.today_count || 0),
    });
  } catch (err) {
    console.error('interview getStats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── DELETE /api/interview-scheduler/candidates/:id ────────────────────────────
exports.deleteCandidate = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE interview_candidates SET deleted = 1 WHERE id = ?`, [id]);
    return res.json({ message: 'Candidate deleted' });
  } catch (err) {
    console.error('interview deleteCandidate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// QUESTION BANK (Admin only)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/interview-scheduler/questions ────────────────────────────────────
exports.listQuestions = async (req, res) => {
  try {
    const { position } = req.query;
    let sql = `SELECT * FROM interview_question_bank`;
    const params = [];
    if (position) { sql += ` WHERE position_name = ?`; params.push(position); }
    sql += ` ORDER BY position_name ASC, order_no ASC`;
    const [rows] = await db.query(sql, params);
    return res.json({ questions: rows });
  } catch (err) {
    console.error('listQuestions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/questions/positions ─────────────────────────
exports.listPositions = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT position_name, COUNT(*) AS question_count
       FROM interview_question_bank
       GROUP BY position_name
       ORDER BY position_name ASC`
    );
    return res.json({ positions: rows });
  } catch (err) {
    console.error('listPositions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/interview-scheduler/questions ───────────────────────────────────
exports.createQuestion = async (req, res) => {
  try {
    const { position_name, question, order_no } = req.body;
    if (!position_name?.trim() || !question?.trim()) {
      return res.status(400).json({ message: 'Position and question are required' });
    }

    // Auto order_no if not provided
    let nextOrder = order_no;
    if (!nextOrder) {
      const [[maxRow]] = await db.query(
        `SELECT COALESCE(MAX(order_no), 0) + 1 AS next_order FROM interview_question_bank WHERE position_name = ?`,
        [position_name.trim()]
      );
      nextOrder = maxRow.next_order;
    }

    const [result] = await db.query(
      `INSERT INTO interview_question_bank (position_name, question, order_no, created_by) VALUES (?, ?, ?, ?)`,
      [position_name.trim(), question.trim(), nextOrder, req.user.id]
    );
    return res.status(201).json({ message: 'Question added', id: result.insertId });
  } catch (err) {
    console.error('createQuestion error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── PATCH /api/interview-scheduler/questions/:id ─────────────────────────────
exports.updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { position_name, question, order_no } = req.body;
    const fields = [];
    const params = [];
    if (position_name !== undefined) { fields.push('position_name = ?'); params.push(position_name); }
    if (question      !== undefined) { fields.push('question = ?');      params.push(question); }
    if (order_no      !== undefined) { fields.push('order_no = ?');      params.push(order_no); }
    if (!fields.length) return res.status(400).json({ message: 'Nothing to update' });
    params.push(id);
    await db.query(`UPDATE interview_question_bank SET ${fields.join(', ')} WHERE id = ?`, params);
    return res.json({ message: 'Question updated' });
  } catch (err) {
    console.error('updateQuestion error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── DELETE /api/interview-scheduler/questions/:id ────────────────────────────
exports.deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM interview_question_bank WHERE id = ?`, [id]);
    return res.json({ message: 'Question deleted' });
  } catch (err) {
    console.error('deleteQuestion error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/candidates/:id/resume ───────────────────────
// Authenticated proxy — streams the resume PDF from the joinus storage server.
// Keeps the file behind auth so the direct storage URL (which is blocked) is
// never exposed to the browser.
exports.getResume = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT resume_path FROM interview_candidates WHERE id = ? AND deleted = 0`,
      [id]
    );
    if (!rows.length || !rows[0].resume_path) {
      return res.status(404).json({ message: 'Resume not found' });
    }

    const resumeUrl = rows[0].resume_path; // full URL stored by joinus e.g. https://joinus.affixxmedia.com/storage/resumes/xxx.pdf

    // Validate it looks like a URL we trust
    if (!resumeUrl.startsWith('http')) {
      return res.status(400).json({ message: 'Invalid resume path' });
    }

    const urlObj = new URL(resumeUrl);
    const lib    = urlObj.protocol === 'https:' ? https : http;

    const proxyReq = lib.get(resumeUrl, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        return res.status(proxyRes.statusCode).json({ message: 'Could not fetch resume from storage' });
      }

      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="resume_candidate_${id}.pdf"`);
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Resume proxy error:', err);
      if (!res.headersSent) res.status(502).json({ message: 'Failed to fetch resume' });
    });
  } catch (err) {
    console.error('getResume error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
