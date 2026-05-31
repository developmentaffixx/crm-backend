const db = require('../config/db');

const DAILY_TARGETS = {
  leads_sourced: 40,
  total_outreach: 40,
  follow_ups_done: 20,
  calls_done: 5,
  meetings_booked: 3,
};
const WORKING_DAYS_PER_WEEK = 6;

/**
 * Generate weekly review data for a user
 */
async function generateWeeklyReviewData(userId, weekStart, weekEnd) {
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
  const replyRate = data.total_outreach_sent > 0 ? (data.total_replies_received / data.total_outreach_sent) * 100 : 0;
  const meetingBookingRate = data.total_replies_received > 0 ? (data.total_meetings_booked / data.total_replies_received) * 100 : 0;
  const followUpConsistency = data.total_follow_ups_done / WORKING_DAYS_PER_WEEK;
  const crmDisciplineScore = (data.days_crm_updated / WORKING_DAYS_PER_WEEK) * 100;

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
    ...data,
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
 * Start the performance cron jobs using setInterval (same pattern as payrollCron)
 */
function startPerformanceCron() {
  console.log('[PerformanceCron] Scheduler started. Weekly: Sat 23:00, Monthly: 1st 01:00.');

  // Check every minute
  setInterval(async () => {
    const now = new Date();
    const day = now.getDay();      // 0=Sun, 6=Sat
    const date = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // ── Weekly: Saturday at 23:00 ──
    if (day === 6 && hour === 23 && minute === 0) {
      console.log('[PerformanceCron] Running weekly review auto-generation...');
      try {
        const weekEnd = now.toISOString().split('T')[0];
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 5);
        const weekStartStr = weekStart.toISOString().split('T')[0];

        const [users] = await db.query('SELECT id FROM users WHERE is_active = 1');

        for (const user of users) {
          const data = await generateWeeklyReviewData(user.id, weekStartStr, weekEnd);

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
              user.id, weekStartStr, weekEnd,
              data.total_leads_sourced, data.total_outreach_sent,
              data.total_follow_ups_done, data.total_calls_completed,
              data.total_replies_received, data.total_interested_leads,
              data.total_meetings_booked, data.days_reported, data.days_crm_updated,
              data.reply_rate, data.meeting_booking_rate, data.follow_up_consistency,
              data.lead_activity_score, data.crm_discipline_score,
              data.overall_score, data.performance_status,
            ]
          );
        }

        console.log(`[PerformanceCron] Weekly reviews generated for ${users.length} users`);
      } catch (err) {
        console.error('[PerformanceCron] Weekly review error:', err.message);
      }
    }

    // ── Monthly: 1st of month at 01:00 ──
    if (date === 1 && hour === 1 && minute === 0) {
      console.log('[PerformanceCron] Running monthly evaluation auto-generation...');
      try {
        const prevMonth = new Date(now);
        prevMonth.setMonth(prevMonth.getMonth() - 1);
        const evalMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
        const monthEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).toISOString().split('T')[0];

        // Count working days
        let workingDays = 0;
        const d = new Date(evalMonth);
        while (d <= new Date(monthEnd)) {
          const wd = d.getDay();
          if (wd >= 1 && wd <= 6) workingDays++;
          d.setDate(d.getDate() + 1);
        }

        const [users] = await db.query('SELECT id FROM users WHERE is_active = 1');

        for (const user of users) {
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
            [user.id, evalMonth, monthEnd]
          );

          const data = rows[0];
          const outreachConsistency = workingDays > 0 ? (data.days_reported / workingDays) * 100 : 0;
          const replyRate = data.total_outreach_sent > 0 ? (data.total_replies_received / data.total_outreach_sent) * 100 : 0;
          const meetingConversionRate = data.total_replies_received > 0 ? (data.total_meetings_booked / data.total_replies_received) * 100 : 0;
          const crmDisciplineScore = workingDays > 0 ? (data.days_crm_updated / workingDays) * 100 : 0;

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
          const overallScore = (pipelineContribution * 0.4 + outreachConsistency * 0.2 + replyRate * 0.15 + meetingConversionRate * 0.1 + crmDisciplineScore * 0.15);

          let performanceStatus = 'critical';
          if (overallScore >= 90) performanceStatus = 'excellent';
          else if (overallScore >= 75) performanceStatus = 'very_good';
          else if (overallScore >= 60) performanceStatus = 'good';
          else if (overallScore >= 40) performanceStatus = 'needs_improvement';

          await db.query(
            `INSERT INTO monthly_evaluations 
              (user_id, eval_month, total_leads_sourced, total_outreach_sent,
               total_follow_ups_done, total_calls_completed, total_replies_received,
               total_interested_leads, total_meetings_booked, days_reported, working_days,
               outreach_consistency, reply_rate, meeting_conversion_rate,
               pipeline_contribution, crm_discipline_score, overall_score, performance_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               total_leads_sourced = VALUES(total_leads_sourced),
               total_outreach_sent = VALUES(total_outreach_sent),
               total_follow_ups_done = VALUES(total_follow_ups_done),
               total_calls_completed = VALUES(total_calls_completed),
               total_replies_received = VALUES(total_replies_received),
               total_interested_leads = VALUES(total_interested_leads),
               total_meetings_booked = VALUES(total_meetings_booked),
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
              user.id, evalMonth,
              data.total_leads_sourced, data.total_outreach_sent,
              data.total_follow_ups_done, data.total_calls_completed,
              data.total_replies_received, data.total_interested_leads,
              data.total_meetings_booked, data.days_reported, workingDays,
              Math.round(outreachConsistency * 100) / 100,
              Math.round(replyRate * 100) / 100,
              Math.round(meetingConversionRate * 100) / 100,
              Math.round(pipelineContribution * 100) / 100,
              Math.round(crmDisciplineScore * 100) / 100,
              Math.round(overallScore * 100) / 100,
              performanceStatus,
            ]
          );
        }

        console.log(`[PerformanceCron] Monthly evaluations generated for ${users.length} users`);
      } catch (err) {
        console.error('[PerformanceCron] Monthly evaluation error:', err.message);
      }
    }
  }, 60000); // Check every 60 seconds
}

module.exports = { startPerformanceCron };
