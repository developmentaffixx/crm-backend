const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─── DAILY TARGETS (same as dailyReports) ─────────────────────────────────────
const DAILY_TARGETS = {
  leads_sourced: 40,
  total_outreach: 40,
  follow_ups_done: 20,
  calls_done: 5,
  meetings_booked: 3,
};
const WORKING_DAYS_PER_WEEK = 6; // Mon-Sat

/**
 * Auto-generate weekly review for a user from daily_reports data
 */
async function generateWeeklyReview(userId, weekStart, weekEnd) {
  // Aggregate daily reports for the week
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
    [userId, weekStart, weekEnd]
  );

  const data = rows[0];

  // Calculate metrics
  const replyRate = data.total_outreach_sent > 0
    ? (data.total_replies_received / data.total_outreach_sent) * 100 : 0;
  const meetingBookingRate = data.total_replies_received > 0
    ? (data.total_meetings_booked / data.total_replies_received) * 100 : 0;
  const followUpConsistency = WORKING_DAYS_PER_WEEK > 0
    ? data.total_follow_ups_done / WORKING_DAYS_PER_WEEK : 0;
  const crmDisciplineScore = WORKING_DAYS_PER_WEEK > 0
    ? (data.days_crm_updated / WORKING_DAYS_PER_WEEK) * 100 : 0;

  // Lead activity score — combined KPI achievement percentage
  const weeklyTargets = {
    leads_sourced: DAILY_TARGETS.leads_sourced * WORKING_DAYS_PER_WEEK,
    total_outreach: DAILY_TARGETS.total_outreach * WORKING_DAYS_PER_WEEK,
    follow_ups_done: DAILY_TARGETS.follow_ups_done * WORKING_DAYS_PER_WEEK,
    calls_done: DAILY_TARGETS.calls_done * WORKING_DAYS_PER_WEEK,
    meetings_booked: DAILY_TARGETS.meetings_booked * WORKING_DAYS_PER_WEEK,
  };

  const scores = [
    Math.min((data.total_leads_sourced / weeklyTargets.leads_sourced) * 100, 100),
    Math.min((data.total_outreach_sent / weeklyTargets.total_outreach) * 100, 100),
    Math.min((data.total_follow_ups_done / weeklyTargets.follow_ups_done) * 100, 100),
    Math.min((data.total_calls_completed / weeklyTargets.calls_done) * 100, 100),
    Math.min((data.total_meetings_booked / weeklyTargets.meetings_booked) * 100, 100),
  ];

  const leadActivityScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const overallScore = (leadActivityScore * 0.6 + crmDisciplineScore * 0.2 + replyRate * 0.2);

  let performanceStatus = 'red';
  if (overallScore >= 80) performanceStatus = 'green';
  else if (overallScore >= 50) performanceStatus = 'yellow';

  return {
    user_id: userId,
    week_start: weekStart,
    week_end: weekEnd,
    total_leads_sourced: data.total_leads_sourced,
    total_outreach_sent: data.total_outreach_sent,
    total_follow_ups_done: data.total_follow_ups_done,
    total_calls_completed: data.total_calls_completed,
    total_replies_received: data.total_replies_received,
    total_interested_leads: data.total_interested_leads,
    total_meetings_booked: data.total_meetings_booked,
    days_reported: data.days_reported,
    days_crm_updated: data.days_crm_updated,
    reply_rate: Math.round(replyRate * 100) / 100,
    meeting_booking_rate: Math.round(meetingBookingRate * 100) / 100,
    follow_up_consistency: Math.round(followUpConsistency * 100) / 100,
    lead_activity_score: Math.round(leadActivityScore * 100) / 100,
    crm_discipline_score: Math.round(crmDisciplineScore * 100) / 100,
    overall_score: Math.round(overallScore * 100) / 100,
    performance_status: performanceStatus,
  };
}

/**
 * GET /api/weekly-reviews
 * List weekly reviews (paginated, filtered by user_id, date range)
 */
exports.list = async (req, res) => {
  try {
    const { user_id, week_start, week_end, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND wr.user_id = ?';
      params.push(req.user.id);
    } else if (user_id) {
      where += ' AND wr.user_id = ?';
      params.push(user_id);
    }

    if (week_start) { where += ' AND wr.week_start >= ?'; params.push(week_start); }
    if (week_end)   { where += ' AND wr.week_end <= ?';   params.push(week_end); }

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM weekly_reviews wr WHERE ${where}`, params
    );
    const total = countResult[0].total;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT wr.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM weekly_reviews wr
       LEFT JOIN users u ON u.id = wr.user_id
       WHERE ${where}
       ORDER BY wr.week_start DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      reviews: rows,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('WeeklyReviews list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/weekly-reviews/:id
 * Get single weekly review with manager review and self review
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT wr.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM weekly_reviews wr
       LEFT JOIN users u ON u.id = wr.user_id
       WHERE wr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Weekly review not found' });

    const review = rows[0];

    if (!req.user.is_admin && review.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch manager review
    const [managerReviews] = await db.query(
      `SELECT wmr.*, CONCAT(u.first_name, ' ', u.last_name) AS reviewer_name
       FROM weekly_manager_reviews wmr
       LEFT JOIN users u ON u.id = wmr.reviewer_id
       WHERE wmr.weekly_review_id = ?`,
      [review.id]
    );
    review.manager_review = managerReviews[0] || null;

    // Fetch self review
    const [selfReviews] = await db.query(
      `SELECT * FROM weekly_self_reviews WHERE weekly_review_id = ?`,
      [review.id]
    );
    review.self_review = selfReviews[0] || null;

    return res.json(review);
  } catch (err) {
    console.error('WeeklyReviews getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/weekly-reviews/generate
 * Auto-generate weekly reviews for all users (or specific user) for a given week
 * Admin only
 */
exports.generate = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin can generate weekly reviews' });
    }

    let { week_start, week_end, user_id } = req.body;

    // Default: last complete week (Mon-Sat)
    if (!week_start || !week_end) {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...6=Sat
      const lastSat = new Date(now);
      lastSat.setDate(now.getDate() - (dayOfWeek === 0 ? 1 : dayOfWeek));
      const lastMon = new Date(lastSat);
      lastMon.setDate(lastSat.getDate() - 5);

      week_start = lastMon.toISOString().split('T')[0];
      week_end = lastSat.toISOString().split('T')[0];
    }

    // Get users to generate for
    let users;
    if (user_id) {
      users = [{ id: user_id }];
    } else {
      const [allUsers] = await db.query('SELECT id FROM users WHERE is_active = 1');
      users = allUsers;
    }

    const generated = [];
    for (const u of users) {
      const reviewData = await generateWeeklyReview(u.id, week_start, week_end);

      // Upsert
      await db.query(
        `INSERT INTO weekly_reviews 
          (user_id, week_start, week_end, total_leads_sourced, total_outreach_sent,
           total_follow_ups_done, total_calls_completed, total_replies_received,
           total_interested_leads, total_meetings_booked, days_reported, days_crm_updated,
           reply_rate, meeting_booking_rate, follow_up_consistency, lead_activity_score,
           crm_discipline_score, overall_score, performance_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           total_leads_sourced = VALUES(total_leads_sourced),
           total_outreach_sent = VALUES(total_outreach_sent),
           total_follow_ups_done = VALUES(total_follow_ups_done),
           total_calls_completed = VALUES(total_calls_completed),
           total_replies_received = VALUES(total_replies_received),
           total_interested_leads = VALUES(total_interested_leads),
           total_meetings_booked = VALUES(total_meetings_booked),
           days_reported = VALUES(days_reported),
           days_crm_updated = VALUES(days_crm_updated),
           reply_rate = VALUES(reply_rate),
           meeting_booking_rate = VALUES(meeting_booking_rate),
           follow_up_consistency = VALUES(follow_up_consistency),
           lead_activity_score = VALUES(lead_activity_score),
           crm_discipline_score = VALUES(crm_discipline_score),
           overall_score = VALUES(overall_score),
           performance_status = VALUES(performance_status)`,
        [
          reviewData.user_id, reviewData.week_start, reviewData.week_end,
          reviewData.total_leads_sourced, reviewData.total_outreach_sent,
          reviewData.total_follow_ups_done, reviewData.total_calls_completed,
          reviewData.total_replies_received, reviewData.total_interested_leads,
          reviewData.total_meetings_booked, reviewData.days_reported, reviewData.days_crm_updated,
          reviewData.reply_rate, reviewData.meeting_booking_rate, reviewData.follow_up_consistency,
          reviewData.lead_activity_score, reviewData.crm_discipline_score,
          reviewData.overall_score, reviewData.performance_status,
        ]
      );
      generated.push(reviewData);
    }

    return res.status(201).json({
      message: `Generated ${generated.length} weekly review(s)`,
      week_start,
      week_end,
      reviews: generated,
    });
  } catch (err) {
    console.error('WeeklyReviews generate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/weekly-reviews/:id/manager-review
 * Submit or update manager review (admin only)
 */
exports.submitManagerReview = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin/manager can submit reviews' });
    }

    const [existing] = await db.query('SELECT id FROM weekly_reviews WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Weekly review not found' });

    const {
      communication_quality, lead_quality, follow_up_discipline, crm_discipline,
      strengths_observed, weakness_observed, improvements_required, training_recommended
    } = req.body;

    await db.query(
      `INSERT INTO weekly_manager_reviews 
        (weekly_review_id, reviewer_id, communication_quality, lead_quality,
         follow_up_discipline, crm_discipline, strengths_observed, weakness_observed,
         improvements_required, training_recommended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         communication_quality = VALUES(communication_quality),
         lead_quality = VALUES(lead_quality),
         follow_up_discipline = VALUES(follow_up_discipline),
         crm_discipline = VALUES(crm_discipline),
         strengths_observed = VALUES(strengths_observed),
         weakness_observed = VALUES(weakness_observed),
         improvements_required = VALUES(improvements_required),
         training_recommended = VALUES(training_recommended)`,
      [
        req.params.id, req.user.id,
        communication_quality || null, lead_quality || null,
        follow_up_discipline || null, crm_discipline || null,
        strengths_observed || null, weakness_observed || null,
        improvements_required || null, training_recommended ? 1 : 0,
      ]
    );

    return res.json({ message: 'Manager review submitted' });
  } catch (err) {
    console.error('WeeklyReviews submitManagerReview error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/weekly-reviews/:id/self-review
 * Submit or update self review (employee)
 */
exports.submitSelfReview = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM weekly_reviews WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Weekly review not found' });

    // Only the review owner can submit self-review
    if (existing[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only submit self-review for your own review' });
    }

    const { biggest_challenge, best_achievement, skills_need_improvement, next_week_focus } = req.body;

    await db.query(
      `INSERT INTO weekly_self_reviews 
        (weekly_review_id, user_id, biggest_challenge, best_achievement,
         skills_need_improvement, next_week_focus)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         biggest_challenge = VALUES(biggest_challenge),
         best_achievement = VALUES(best_achievement),
         skills_need_improvement = VALUES(skills_need_improvement),
         next_week_focus = VALUES(next_week_focus)`,
      [
        req.params.id, req.user.id,
        biggest_challenge || null, best_achievement || null,
        skills_need_improvement || null, next_week_focus || null,
      ]
    );

    return res.json({ message: 'Self review submitted' });
  } catch (err) {
    console.error('WeeklyReviews submitSelfReview error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/weekly-reviews/leaderboard
 * Returns leaderboard for the most recent week (or specified week)
 */
exports.leaderboard = async (req, res) => {
  try {
    let { week_start } = req.query;

    if (!week_start) {
      // Get most recent week
      const [latest] = await db.query('SELECT MAX(week_start) AS latest FROM weekly_reviews');
      week_start = latest[0]?.latest;
      if (!week_start) return res.json([]);
    }

    const [rows] = await db.query(
      `SELECT wr.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM weekly_reviews wr
       LEFT JOIN users u ON u.id = wr.user_id
       WHERE wr.week_start = ?
       ORDER BY wr.overall_score DESC`,
      [week_start]
    );

    // Add rank
    const leaderboard = rows.map((row, idx) => ({ ...row, rank: idx + 1 }));

    return res.json({ week_start, leaderboard });
  } catch (err) {
    console.error('WeeklyReviews leaderboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
