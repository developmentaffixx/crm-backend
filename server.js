require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { initSocket } = require('./src/config/socket');

const authRoutes      = require('./src/routes/auth.routes');
const tasksRoutes     = require('./src/routes/tasks.routes');
const approvalsRoutes = require('./src/routes/approvals.routes');
const usersRoutes     = require('./src/routes/users.routes');
const settingsRoutes  = require('./src/routes/settings.routes');
const emailRoutes     = require('./src/routes/email.routes');
const companyRoutes   = require('./src/routes/company.routes');
const leadsRoutes     = require('./src/routes/leads.routes');
const plansRoutes     = require('./src/routes/plans.routes');
const pitchDeckRoutes = require('./src/routes/pitchDeck.routes');
const invoicesRoutes  = require('./src/routes/invoices.routes');
const expensesRoutes  = require('./src/routes/expenses.routes');
const capitalRoutes   = require('./src/routes/capital.routes');
const assetsRoutes    = require('./src/routes/assets.routes');
const payrollRoutes   = require('./src/routes/payroll.routes');
const projectsRoutes  = require('./src/routes/projects.routes');
const clientsRoutes   = require('./src/routes/clients.routes');
const calendarRoutes  = require('./src/routes/calendar.routes');
const leavesRoutes   = require('./src/routes/leaves.routes');
const reimbursementsRoutes = require('./src/routes/reimbursements.routes');
const announcementsRoutes = require('./src/routes/announcements.routes');
const attendanceRoutes   = require('./src/routes/attendance.routes');
const dashboardRoutes    = require('./src/routes/dashboard.routes');
const compensationRoutes = require('./src/routes/compensation.routes');
const ticketsRoutes = require('./src/routes/tickets.routes');
const chatRoutes    = require('./src/routes/chat.routes');
const vendorAgreementsRoutes = require('./src/routes/vendorAgreements.routes');
const pitchDeckIndustriesRoutes = require('./src/routes/pitchDeckIndustries.routes');
const meetingsRoutes = require('./src/routes/meetings.routes');
const reportsRoutes  = require('./src/routes/reports.routes');
const contentWriteRoutes = require('./src/routes/contentWrite.routes');
const contentCalendarRoutes = require('./src/routes/contentCalendar.routes');
const shootsRoutes = require('./src/routes/shoots.routes');
const ibrsSettingsRoutes = require('./src/routes/ibrsSettings.routes');
const clientPlansRoutes  = require('./src/routes/clientPlans.routes');
const workScheduleRoutes = require('./src/routes/workSchedule.routes');
const holidaysRoutes     = require('./src/routes/holidays.routes');
const onboardingRoutes   = require('./src/routes/onboarding.routes');
const interviewSchedulerRoutes = require('./src/routes/interviewScheduler.routes');
const dailyReportsRoutes = require('./src/routes/dailyReports.routes');
const weeklyReviewsRoutes = require('./src/routes/weeklyReviews.routes');
const monthlyEvaluationsRoutes = require('./src/routes/monthlyEvaluations.routes');
const notificationsRoutes = require('./src/routes/notifications.routes');
const recurringExpensesRoutes = require('./src/routes/recurringExpenses.routes');
const proposalsRoutes          = require('./src/routes/proposals.routes');
const proposalPlansRoutes      = require('./src/routes/proposalPlans.routes');
const serviceCyclesRoutes      = require('./src/routes/serviceCycles.routes');
const withdrawalsRoutes        = require('./src/routes/withdrawals.routes');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;

// ── Socket.IO ─────────────────────────────────────────────────────────────────
initSocket(server);

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Handle preflight requests explicitly
app.options('*', cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

// Attach socket emit helper to all routes
const socketEmitMiddleware = require('./src/middleware/socketEmit');
app.use(socketEmitMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/tasks',     tasksRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/users',     usersRoutes);
app.use('/api/settings/email', emailRoutes);
app.use('/api/settings/company', companyRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/leads',            leadsRoutes);
app.use('/api/plans',            plansRoutes);
app.use('/api/pitch-decks',      pitchDeckRoutes);
app.use('/api/invoices',         invoicesRoutes);
app.use('/api/expenses',         expensesRoutes);
app.use('/api/capital',          capitalRoutes);
app.use('/api/assets',           assetsRoutes);
app.use('/api/payroll',          payrollRoutes);
app.use('/api/projects',         projectsRoutes);
app.use('/api/clients',          clientsRoutes);
app.use('/api/calendar',         calendarRoutes);
app.use('/api/leaves',           leavesRoutes);
app.use('/api/reimbursements',   reimbursementsRoutes);
app.use('/api/announcements',    announcementsRoutes);
app.use('/api/attendance',       attendanceRoutes);
app.use('/api/dashboard',        dashboardRoutes);
app.use('/api/compensation',    compensationRoutes);
app.use('/api/tickets',          ticketsRoutes);
app.use('/api/chat',             chatRoutes);
app.use('/api/vendor-agreements', vendorAgreementsRoutes);
app.use('/api/pitch-deck-industries', pitchDeckIndustriesRoutes);
app.use('/api/meetings',              meetingsRoutes);
app.use('/api/reports',               reportsRoutes);
app.use('/api/content-write',         contentWriteRoutes);
app.use('/api/content-calendar',      contentCalendarRoutes);
app.use('/api/shoots',                shootsRoutes);
app.use('/api/ibrs-settings',         ibrsSettingsRoutes);
app.use('/api/client-plans',          clientPlansRoutes);
app.use('/api/work-schedule',         workScheduleRoutes);
app.use('/api/holidays',              holidaysRoutes);
app.use('/api/onboarding',            onboardingRoutes);
app.use('/api/interview-scheduler',   interviewSchedulerRoutes);
app.use('/api/daily-reports',         dailyReportsRoutes);
app.use('/api/weekly-reviews',        weeklyReviewsRoutes);
app.use('/api/monthly-evaluations',   monthlyEvaluationsRoutes);
app.use('/api/notifications',         notificationsRoutes);
app.use('/api/recurring-expenses',    recurringExpensesRoutes);
app.use('/api/proposals',             proposalsRoutes);
app.use('/api/proposal-plans',        proposalPlansRoutes);
app.use('/api/projects',              serviceCyclesRoutes);
app.use('/api/withdrawals',           withdrawalsRoutes);

// Rule Book — accessible to all authenticated users (not admin-only)
const { authenticate: authMiddleware } = require('./src/middleware/auth');
const docTemplatesCtrl = require('./src/controllers/documentTemplates.controller');
app.get('/api/rule-book', authMiddleware, docTemplatesCtrl.getRuleBook);

// Serve uploaded files (logos, favicons)
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── DB connection check ───────────────────────────────────────────────────────
app.get('/api/health/db', async (_req, res) => {
  try {
    const db = require('./src/config/db');
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`✅  CRM Task API running on http://localhost:${PORT}`);
  console.log(`🔌  Socket.IO ready for real-time connections`);

  // ── Start Payroll Auto-Generate Cron ────────────────────────────────────────
  const { startPayrollCron } = require('./src/jobs/payrollCron');
  startPayrollCron();

  // ── Start Performance Review Cron ──────────────────────────────────────────
  const { startPerformanceCron } = require('./src/jobs/performanceCron');
  startPerformanceCron();

  // ── Start Recurring Expenses Cron ───────────────────────────────────────────
  const { startRecurringExpensesCron } = require('./src/jobs/recurringExpensesCron');
  startRecurringExpensesCron();

  // ── Start Auto Clock-Out Cron (7:00 PM IST daily) ───────────────────────────
  const { startAutoClockOutCron } = require('./src/jobs/autoClockOutCron');
  startAutoClockOutCron();
});
