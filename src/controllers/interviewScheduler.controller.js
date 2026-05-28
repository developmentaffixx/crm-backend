const db = require('../config/db');

// ── GET /api/interview-scheduler/candidates ───────────────────────────────────
exports.listCandidates = async (req, res) => {
  try {
    const { search, status, source } = req.query;

    let sql = `
      SELECT
        ic.*,
        u.name AS shortlisted_by_name
      FROM interview_candidates ic
      LEFT JOIN users u ON u.id = ic.shortlisted_by
      WHERE ic.deleted = 0
    `;
    const params = [];

    if (search) {
      sql += ` AND (ic.full_name LIKE ? OR ic.email LIKE ? OR ic.contact_number LIKE ? OR ic.position_applied LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (status) {
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
      `SELECT ir.*, u.name AS interviewer_name
       FROM interview_rounds ir
       LEFT JOIN users u ON u.id = ir.interviewer_id
       WHERE ir.candidate_id = ? AND ir.deleted = 0
       ORDER BY ir.round_number ASC`,
      [id]
    );

    const candidate = candidates[0];
    // Parse JSON fields
    candidate.siblings = candidate.siblings ? (typeof candidate.siblings === 'string' ? JSON.parse(candidate.siblings) : candidate.siblings) : [];
    candidate.referrals = candidate.referrals ? (typeof candidate.referrals === 'string' ? JSON.parse(candidate.referrals) : candidate.referrals) : [];

    return res.json({ candidate, rounds });
  } catch (err) {
    console.error('interview getCandidate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/interview-scheduler/candidates (manual add) ─────────────────────
exports.createCandidate = async (req, res) => {
  try {
    const { full_name, email, contact_number, position_applied, source } = req.body;

    if (!full_name?.trim() || !position_applied?.trim()) {
      return res.status(400).json({ message: 'Name and position are required' });
    }

    const [result] = await db.query(
      `INSERT INTO interview_candidates (full_name, email, contact_number, position_applied, source, status)
       VALUES (?, ?, ?, ?, ?, 'shortlisted')`,
      [
        full_name.trim(),
        email?.trim() || null,
        contact_number?.trim() || null,
        position_applied.trim(),
        source || 'other',
      ]
    );

    return res.status(201).json({ message: 'Candidate added', id: result.insertId });
  } catch (err) {
    console.error('interview createCandidate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── POST /api/interview-scheduler/applications (public - joinus form) ─────────
exports.submitApplication = async (req, res) => {
  try {
    const d = req.body;

    if (!d.full_name?.trim() || !d.position_applied?.trim()) {
      return res.status(400).json({ message: 'Name and position are required' });
    }

    const siblingsJson = d.siblings && Array.isArray(d.siblings) && d.siblings.length ? JSON.stringify(d.siblings) : null;
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'joinus_form', 'new')`,
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

    const validStatuses = ['new', 'shortlisted', 'in_process', 'selected', 'rejected', 'on_hold'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updates = { status };
    if (status === 'shortlisted') {
      updates.shortlisted_by = req.user.id;
      updates.shortlisted_at = new Date();
    }

    await db.query(
      `UPDATE interview_candidates SET status = ?, shortlisted_by = ?, shortlisted_at = ? WHERE id = ? AND deleted = 0`,
      [updates.status, updates.shortlisted_by || null, updates.shortlisted_at || null, id]
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
      `UPDATE interview_candidates SET status = 'in_process' WHERE id = ? AND status = 'shortlisted'`,
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

    if (verdict !== undefined) { fields.push('verdict = ?'); params.push(verdict); }
    if (remarks !== undefined) { fields.push('remarks = ?'); params.push(remarks); }
    if (rating !== undefined) { fields.push('rating = ?'); params.push(rating); }
    if (scheduled_date !== undefined) { fields.push('scheduled_date = ?'); params.push(scheduled_date); }
    if (scheduled_time !== undefined) { fields.push('scheduled_time = ?'); params.push(scheduled_time); }
    if (interviewer_id !== undefined) { fields.push('interviewer_id = ?'); params.push(interviewer_id); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }

    if (verdict) {
      fields.push('completed_at = NOW()');
      fields.push('status = ?');
      params.push('completed');
    }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

    params.push(id);
    await db.query(`UPDATE interview_rounds SET ${fields.join(', ')} WHERE id = ? AND deleted = 0`, params);

    // If verdict is rejected, update candidate status
    if (verdict === 'rejected') {
      const [round] = await db.query(`SELECT candidate_id FROM interview_rounds WHERE id = ?`, [id]);
      if (round.length) {
        await db.query(`UPDATE interview_candidates SET status = 'rejected' WHERE id = ?`, [round[0].candidate_id]);
      }
    }

    // If verdict is selected, check if this was the final decision
    if (verdict === 'selected') {
      const [round] = await db.query(`SELECT candidate_id FROM interview_rounds WHERE id = ?`, [id]);
      if (round.length) {
        // Keep status as in_process — HR can manually mark as 'selected' when all rounds done
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
        u.name AS interviewer_name
      FROM interview_rounds ir
      JOIN interview_candidates ic ON ic.id = ir.candidate_id
      LEFT JOIN users u ON u.id = ir.interviewer_id
      WHERE ir.deleted = 0 AND ir.status = 'scheduled'
    `;
    const params = [];

    if (from) {
      sql += ` AND ir.scheduled_date >= ?`;
      params.push(from);
    }
    if (to) {
      sql += ` AND ir.scheduled_date <= ?`;
      params.push(to);
    }

    sql += ` ORDER BY ir.scheduled_date ASC, ir.scheduled_time ASC`;

    const [rows] = await db.query(sql, params);
    return res.json({ schedule: rows });
  } catch (err) {
    console.error('interview getSchedule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── GET /api/interview-scheduler/stats ────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'new') AS new_count,
        SUM(status = 'shortlisted') AS shortlisted_count,
        SUM(status = 'in_process') AS in_process_count,
        SUM(status = 'selected') AS selected_count,
        SUM(status = 'rejected') AS rejected_count,
        SUM(status = 'on_hold') AS on_hold_count
      FROM interview_candidates
      WHERE deleted = 0
    `);
    return res.json(rows[0]);
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
