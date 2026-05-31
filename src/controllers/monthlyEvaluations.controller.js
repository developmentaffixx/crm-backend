const { validationResult } = require('express-validator');
const db = require('../config/db');

const DAILY_TARGETS = {
  leads_sourced: 40,
  total_outreach: 40,
  follow_ups_done: 20,
  calls_done: 5,
  meetings_booked: 3,
};

/**
 * Auto-generate monthly evaluation for a user from daily_reports data
 */
async function generateMonthlyEvaluation(userId, evalMonth) {
  // evalMonth = 'YYYY-MM-01'
  const monthStart = evalMonth;
  const nextMonth = new Date(evalMonth);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const monthEnd = new Date(nextMonth - 1).toISOString().split('T')[0];

  // Count working days in the month (Mon-Sat)
  let workingDays = 0;
  const d = new Date(monthStart);
  while (d <= new Date(monthEnd)) {
    const day = d.getDay();
    if (day >= 1 && day <= 6) workingDays++; // Mon=1 to Sat=6
    d.setDate(d.getDate() + 1);
  }

  // Aggregate daily reports
  const [rows] = await db.query(
    `SELECT 
      COUNT(*) AS days_reported,
      COALESCE(SUM(leads_sourced), 0) AS total_leads_sourced,
      COALESCE(SUM(instagram_outreach + whatsapp_outreach + email_outreach + linkedin_outreach), 0) AS total_outreach_sent,
      COALESCE(SUM(follow_ups_done), 0) AS total_follow_ups_done,
      COALESCE(SUM(calls_done), 0) AS total_calls_completed,
      COALESCE(SUM(replies_received), 0) AS total_replies_received,
      COALESCE(SUM(interested_leads), 0) AS total_interested_leads,
      COALESCE(SUM(meetings_booked), 0) AS total_meetings_booked,
      COALESCE(SUM(crm_updated), 0) AS days_crm_updated
     FROM daily_reports
     WHERE user_id = ? AND report_date >= ? AND report_date <= ?`,
    [userId, monthStart, monthEnd]
  );

  const data = rows[0];

  // Calculate metrics
  const outreachConsistency = workingDays > 0
    ? (data.days_reported / workingDays) * 100 : 0;
  const replyRate = data.total_outreach_sent > 0
    ? (data.total_replies_received / data.total_outreach_sent) * 100 : 0;
  const meetingConversionRate = data.total_replies_received > 0
    ? (data.total_meetings_booked / data.total_replies_received) * 100 : 0;
  const crmDisciplineScore = workingDays > 0
    ? (data.days_crm_updated / workingDays) * 100 : 0;

  // Pipeline contribution — weighted score of lead-related KPIs
  const monthlyTargets = {
    leads_sourced: DAILY_TARGETS.leads_sourced * workingDays,
    total_outreach: DAILY_TARGETS.total_outreach * workingDays,
    follow_ups_done: DAILY_TARGETS.follow_ups_done * workingDays,
    calls_done: DAILY_TARGETS.calls_done * workingDays,
    meetings_booked: DAILY_TARGETS.meetings_booked * workingDays,
  };

  const kpiScores = [
    Math.min((data.total_leads_sourced / monthlyTargets.leads_sourced) * 100, 100),
    Math.min((data.total_outreach_sent / monthlyTargets.total_outreach) * 100, 100),
    Math.min((data.total_follow_ups_done / monthlyTargets.follow_ups_done) * 100, 100),
    Math.min((data.total_calls_completed / monthlyTargets.calls_done) * 100, 100),
    Math.min((data.total_meetings_booked / monthlyTargets.meetings_booked) * 100, 100),
  ];

  const pipelineContribution = kpiScores.reduce((a, b) => a + b, 0) / kpiScores.length;

  // Overall score: weighted combination
  const overallScore = (
    pipelineContribution * 0.4 +
    outreachConsistency * 0.2 +
    replyRate * 0.15 +
    meetingConversionRate * 0.1 +
    crmDisciplineScore * 0.15
  );

  let performanceStatus = 'critical';
  if (overallScore >= 90) performanceStatus = 'excellent';
  else if (overallScore >= 75) performanceStatus = 'very_good';
  else if (overallScore >= 60) performanceStatus = 'good';
  else if (overallScore >= 40) performanceStatus = 'needs_improvement';

  return {
    user_id: userId,
    eval_month: evalMonth,
    total_leads_sourced: data.total_leads_sourced,
    total_outreach_sent: data.total_outreach_sent,
    total_follow_ups_done: data.total_follow_ups_done,
    total_calls_completed: data.total_calls_completed,
    total_replies_received: data.total_replies_received,
    total_interested_leads: data.total_interested_leads,
    total_meetings_booked: data.total_meetings_booked,
    total_proposals_sent: 0,
    total_closures_assisted: 0,
    revenue_contribution: 0,
    days_reported: data.days_reported,
    working_days: workingDays,
    outreach_consistency: Math.round(outreachConsistency * 100) / 100,
    reply_rate: Math.round(replyRate * 100) / 100,
    meeting_conversion_rate: Math.round(meetingConversionRate * 100) / 100,
    pipeline_contribution: Math.round(pipelineContribution * 100) / 100,
    crm_discipline_score: Math.round(crmDisciplineScore * 100) / 100,
    overall_score: Math.round(overallScore * 100) / 100,
    performance_status: performanceStatus,
  };
}

/**
 * GET /api/monthly-evaluations
 */
exports.list = async (req, res) => {
  try {
    const { user_id, eval_month, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND me.user_id = ?';
      params.push(req.user.id);
    } else if (user_id) {
      where += ' AND me.user_id = ?';
      params.push(user_id);
    }

    if (eval_month) { where += ' AND me.eval_month = ?'; params.push(eval_month); }

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM monthly_evaluations me WHERE ${where}`, params
    );
    const total = countResult[0].total;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT me.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM monthly_evaluations me
       LEFT JOIN users u ON u.id = me.user_id
       WHERE ${where}
       ORDER BY me.eval_month DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      evaluations: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('MonthlyEvaluations list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/monthly-evaluations/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT me.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM monthly_evaluations me
       LEFT JOIN users u ON u.id = me.user_id
       WHERE me.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Monthly evaluation not found' });

    const evaluation = rows[0];

    if (!req.user.is_admin && evaluation.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch manager evaluation
    const [managerEvals] = await db.query(
      `SELECT mme.*, CONCAT(u.first_name, ' ', u.last_name) AS reviewer_name
       FROM monthly_manager_evaluations mme
       LEFT JOIN users u ON u.id = mme.reviewer_id
       WHERE mme.monthly_evaluation_id = ?`,
      [evaluation.id]
    );
    evaluation.manager_evaluation = managerEvals[0] || null;

    // Fetch decisions
    const [decisions] = await db.query(
      `SELECT md.*, CONCAT(u.first_name, ' ', u.last_name) AS decided_by_name
       FROM monthly_decisions md
       LEFT JOIN users u ON u.id = md.decided_by
       WHERE md.monthly_evaluation_id = ?`,
      [evaluation.id]
    );
    evaluation.decision = decisions[0] || null;

    // Fetch feedback
    const [feedback] = await db.query(
      `SELECT mf.*, CONCAT(u.first_name, ' ', u.last_name) AS feedback_by_name
       FROM monthly_feedback mf
       LEFT JOIN users u ON u.id = mf.feedback_by
       WHERE mf.monthly_evaluation_id = ?`,
      [evaluation.id]
    );
    evaluation.feedback = feedback[0] || null;

    return res.json(evaluation);
  } catch (err) {
    console.error('MonthlyEvaluations getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/monthly-evaluations/generate
 * Auto-generate monthly evaluations (admin only)
 */
exports.generate = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin can generate monthly evaluations' });
    }

    let { eval_month, user_id } = req.body;

    // Default: previous month
    if (!eval_month) {
      const now = new Date();
      now.setMonth(now.getMonth() - 1);
      eval_month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    // Get users
    let users;
    if (user_id) {
      users = [{ id: user_id }];
    } else {
      const [allUsers] = await db.query('SELECT id FROM users WHERE is_active = 1');
      users = allUsers;
    }

    const generated = [];
    for (const u of users) {
      const evalData = await generateMonthlyEvaluation(u.id, eval_month);

      await db.query(
        `INSERT INTO monthly_evaluations 
          (user_id, eval_month, total_leads_sourced, total_outreach_sent,
           total_follow_ups_done, total_calls_completed, total_replies_received,
           total_interested_leads, total_meetings_booked, total_proposals_sent,
           total_closures_assisted, revenue_contribution, days_reported, working_days,
           outreach_consistency, reply_rate, meeting_conversion_rate,
           pipeline_contribution, crm_discipline_score, overall_score, performance_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           total_leads_sourced = VALUES(total_leads_sourced),
           total_outreach_sent = VALUES(total_outreach_sent),
           total_follow_ups_done = VALUES(total_follow_ups_done),
           total_calls_completed = VALUES(total_calls_completed),
           total_replies_received = VALUES(total_replies_received),
           total_interested_leads = VALUES(total_interested_leads),
           total_meetings_booked = VALUES(total_meetings_booked),
           total_proposals_sent = VALUES(total_proposals_sent),
           total_closures_assisted = VALUES(total_closures_assisted),
           revenue_contribution = VALUES(revenue_contribution),
           days_reported = VALUES(days_reported),
           working_days = VALUES(working_days),
           outreach_consistency = VALUES(outreach_consistency),
           reply_rate = VALUES(reply_rate),
           meeting_conversion_rate = VALUES(meeting_conversion_rate),
           pipeline_contribution = VALUES(pipeline_contribution),
           crm_discipline_score = VALUES(crm_discipline_score),
           overall_score = VALUES(overall_score),
           performance_status = VALUES(performance_status)`,
        [
          evalData.user_id, evalData.eval_month,
          evalData.total_leads_sourced, evalData.total_outreach_sent,
          evalData.total_follow_ups_done, evalData.total_calls_completed,
          evalData.total_replies_received, evalData.total_interested_leads,
          evalData.total_meetings_booked, evalData.total_proposals_sent,
          evalData.total_closures_assisted, evalData.revenue_contribution,
          evalData.days_reported, evalData.working_days,
          evalData.outreach_consistency, evalData.reply_rate,
          evalData.meeting_conversion_rate, evalData.pipeline_contribution,
          evalData.crm_discipline_score, evalData.overall_score,
          evalData.performance_status,
        ]
      );
      generated.push(evalData);
    }

    return res.status(201).json({
      message: `Generated ${generated.length} monthly evaluation(s)`,
      eval_month,
      evaluations: generated,
    });
  } catch (err) {
    console.error('MonthlyEvaluations generate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/monthly-evaluations/:id/manager-evaluation
 * Submit manager evaluation (admin only)
 */
exports.submitManagerEvaluation = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin/manager can submit evaluations' });
    }

    const [existing] = await db.query('SELECT id FROM monthly_evaluations WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Monthly evaluation not found' });

    const {
      communication_skill, consistency, team_contribution, discipline,
      lead_quality, improvement_since_last, leadership_potential, client_interaction_quality
    } = req.body;

    await db.query(
      `INSERT INTO monthly_manager_evaluations 
        (monthly_evaluation_id, reviewer_id, communication_skill, consistency,
         team_contribution, discipline, lead_quality, improvement_since_last,
         leadership_potential, client_interaction_quality)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         communication_skill = VALUES(communication_skill),
         consistency = VALUES(consistency),
         team_contribution = VALUES(team_contribution),
         discipline = VALUES(discipline),
         lead_quality = VALUES(lead_quality),
         improvement_since_last = VALUES(improvement_since_last),
         leadership_potential = VALUES(leadership_potential),
         client_interaction_quality = VALUES(client_interaction_quality)`,
      [
        req.params.id, req.user.id,
        communication_skill || null, consistency || null,
        team_contribution || null, discipline || null,
        lead_quality || null, improvement_since_last || null,
        leadership_potential || null, client_interaction_quality || null,
      ]
    );

    return res.json({ message: 'Manager evaluation submitted' });
  } catch (err) {
    console.error('MonthlyEvaluations submitManagerEvaluation error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/monthly-evaluations/:id/decision
 * Submit monthly decision (admin only)
 */
exports.submitDecision = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin can submit decisions' });
    }

    const [existing] = await db.query('SELECT id FROM monthly_evaluations WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Monthly evaluation not found' });

    const { incentive_eligible, bonus_eligible, warning_required, promotion_ready, training_required } = req.body;

    await db.query(
      `INSERT INTO monthly_decisions 
        (monthly_evaluation_id, decided_by, incentive_eligible, bonus_eligible,
         warning_required, promotion_ready, training_required)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         decided_by = VALUES(decided_by),
         incentive_eligible = VALUES(incentive_eligible),
         bonus_eligible = VALUES(bonus_eligible),
         warning_required = VALUES(warning_required),
         promotion_ready = VALUES(promotion_ready),
         training_required = VALUES(training_required)`,
      [
        req.params.id, req.user.id,
        incentive_eligible ? 1 : 0, bonus_eligible ? 1 : 0,
        warning_required ? 1 : 0, promotion_ready ? 1 : 0, training_required ? 1 : 0,
      ]
    );

    return res.json({ message: 'Decision submitted' });
  } catch (err) {
    console.error('MonthlyEvaluations submitDecision error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/monthly-evaluations/:id/feedback
 * Submit monthly feedback
 */
exports.submitFeedback = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT id FROM monthly_evaluations WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Monthly evaluation not found' });

    const { major_strengths, major_weakness, areas_to_improve, next_month_focus } = req.body;

    await db.query(
      `INSERT INTO monthly_feedback 
        (monthly_evaluation_id, feedback_by, major_strengths, major_weakness,
         areas_to_improve, next_month_focus)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         major_strengths = VALUES(major_strengths),
         major_weakness = VALUES(major_weakness),
         areas_to_improve = VALUES(areas_to_improve),
         next_month_focus = VALUES(next_month_focus)`,
      [
        req.params.id, req.user.id,
        major_strengths || null, major_weakness || null,
        areas_to_improve || null, next_month_focus || null,
      ]
    );

    return res.json({ message: 'Feedback submitted' });
  } catch (err) {
    console.error('MonthlyEvaluations submitFeedback error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/monthly-evaluations/dashboard
 * Performance dashboard data for the current/specified month
 */
exports.dashboard = async (req, res) => {
  try {
    let { eval_month } = req.query;

    if (!eval_month) {
      const [latest] = await db.query('SELECT MAX(eval_month) AS latest FROM monthly_evaluations');
      eval_month = latest[0]?.latest;
      if (!eval_month) return res.json({ rankings: [], stats: {} });
    }

    // Rankings
    const [rankings] = await db.query(
      `SELECT me.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM monthly_evaluations me
       LEFT JOIN users u ON u.id = me.user_id
       WHERE me.eval_month = ?
       ORDER BY me.overall_score DESC`,
      [eval_month]
    );

    // Stats summary
    const [stats] = await db.query(
      `SELECT 
        COUNT(*) AS total_employees,
        AVG(overall_score) AS avg_score,
        SUM(CASE WHEN performance_status = 'excellent' THEN 1 ELSE 0 END) AS excellent_count,
        SUM(CASE WHEN performance_status = 'very_good' THEN 1 ELSE 0 END) AS very_good_count,
        SUM(CASE WHEN performance_status = 'good' THEN 1 ELSE 0 END) AS good_count,
        SUM(CASE WHEN performance_status = 'needs_improvement' THEN 1 ELSE 0 END) AS needs_improvement_count,
        SUM(CASE WHEN performance_status = 'critical' THEN 1 ELSE 0 END) AS critical_count,
        SUM(total_meetings_booked) AS total_meetings,
        SUM(total_outreach_sent) AS total_outreach,
        SUM(total_leads_sourced) AS total_leads
       FROM monthly_evaluations
       WHERE eval_month = ?`,
      [eval_month]
    );

    return res.json({
      eval_month,
      rankings: rankings.map((r, idx) => ({ ...r, rank: idx + 1 })),
      stats: stats[0] || {},
    });
  } catch (err) {
    console.error('MonthlyEvaluations dashboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
