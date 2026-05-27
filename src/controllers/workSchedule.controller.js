const db = require('../config/db');

// ─── Helper: Get which Saturday of the month a date is (1st, 2nd, 3rd, 4th, 5th)
function getSaturdayNumber(date) {
  const d = new Date(date);
  if (d.getDay() !== 6) return 0; // not a Saturday
  return Math.ceil(d.getDate() / 7); // 1st, 2nd, 3rd, 4th, 5th
}

// ─── Helper: Get Monday of the week for a given date
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

// ─── Helper: Resolve Saturday type from pattern
function resolveSaturdayType(saturdayPattern, date) {
  const satNum = getSaturdayNumber(date);
  switch (saturdayPattern) {
    case 'all_full': return 'full';
    case 'all_half': return 'half';
    case 'all_off': return 'off';
    case 'alternate_half_off':
      // 1st & 3rd = half, 2nd & 4th & 5th = off
      return (satNum === 1 || satNum === 3) ? 'half' : 'off';
    case 'alternate_full_off':
      // 1st & 3rd = full, 2nd & 4th & 5th = off
      return (satNum === 1 || satNum === 3) ? 'full' : 'off';
    default:
      return 'half';
  }
}

// ─── CORE: Get expected hours for a specific date ─────────────────────────────
// Priority: 1. company_holidays → 2. weekly_schedule_overrides → 3. default pattern
async function getExpectedHoursForDate(date) {
  const dateStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
  const dateObj = new Date(dateStr);
  const dayOfWeek = dateObj.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Get schedule settings
  const [schedule] = await db.query('SELECT * FROM work_schedule WHERE id = 1');
  const s = schedule[0];

  // 1. Check company_holidays first (highest priority)
  const [holidays] = await db.query('SELECT * FROM company_holidays WHERE date = ?', [dateStr]);
  if (holidays.length > 0) {
    const holiday = holidays[0];
    if (holiday.holiday_type === 'full_holiday') {
      return { hours: 0, type: 'holiday', title: holiday.title, lunch_minutes: 0 };
    }
    if (holiday.holiday_type === 'half_day') {
      return { hours: parseFloat(s.half_day_hours), type: 'half_day_holiday', title: holiday.title, session: holiday.half_day_session, lunch_minutes: parseInt(s.lunch_minutes_half) };
    }
    // 'restricted' = optional, treat as normal working day
  }

  // 2. Check weekly_schedule_overrides
  const weekStart = getWeekStart(dateStr);
  const [overrides] = await db.query('SELECT * FROM weekly_schedule_overrides WHERE week_start = ?', [weekStart]);

  if (overrides.length > 0) {
    const override = overrides[0];
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];
    const dayType = override[`${dayName}_type`];

    if (dayType === 'off') {
      return { hours: 0, type: 'override_off', title: `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} Off (Override)`, lunch_minutes: 0 };
    }
    if (dayType === 'half') {
      return { hours: parseFloat(s.half_day_hours), type: 'override_half', title: 'Half Day (Override)', lunch_minutes: parseInt(s.lunch_minutes_half) };
    }
    return { hours: parseFloat(s.full_day_hours), type: 'override_full', title: 'Full Day (Override)', lunch_minutes: parseInt(s.lunch_minutes_full) };
  }

  // 3. Fall back to default pattern
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayOfWeek];

  // Special handling for Saturday (uses pattern)
  if (dayOfWeek === 6) {
    const satType = resolveSaturdayType(s.saturday_pattern, dateStr);
    if (satType === 'off') {
      return { hours: 0, type: 'weekly_off', title: 'Saturday Off', lunch_minutes: 0 };
    }
    if (satType === 'half') {
      return { hours: parseFloat(s.half_day_hours), type: 'half_day', title: 'Saturday Half Day', lunch_minutes: parseInt(s.lunch_minutes_half) };
    }
    return { hours: parseFloat(s.full_day_hours), type: 'full_day', title: 'Saturday Full Day', lunch_minutes: parseInt(s.lunch_minutes_full) };
  }

  // Regular day (Mon-Fri, Sunday)
  const dayType = s[`${dayName}_type`];
  if (dayType === 'off') {
    return { hours: 0, type: 'weekly_off', title: `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} Off`, lunch_minutes: 0 };
  }
  if (dayType === 'half') {
    return { hours: parseFloat(s.half_day_hours), type: 'half_day', title: 'Half Day', lunch_minutes: parseInt(s.lunch_minutes_half) };
  }
  return { hours: parseFloat(s.full_day_hours), type: 'full_day', title: 'Full Day', lunch_minutes: parseInt(s.lunch_minutes_full) };
}

// ─── CORE: Get expected hours for a date range ────────────────────────────────
async function getExpectedHoursForRange(startDate, endDate, userId = null) {
  let totalExpected = 0;
  const dailyBreakdown = [];

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Batch fetch holidays in range
  const [holidays] = await db.query(
    'SELECT * FROM company_holidays WHERE date BETWEEN ? AND ?',
    [startDate, endDate]
  );
  const holidayMap = {};
  for (const h of holidays) {
    const key = new Date(h.date).toISOString().split('T')[0];
    holidayMap[key] = h;
  }

  // Batch fetch overrides in range
  const [overrides] = await db.query(
    'SELECT * FROM weekly_schedule_overrides WHERE week_start BETWEEN DATE_SUB(?, INTERVAL 6 DAY) AND ?',
    [startDate, endDate]
  );
  const overrideMap = {};
  for (const o of overrides) {
    const key = new Date(o.week_start).toISOString().split('T')[0];
    overrideMap[key] = o;
  }

  // Get default schedule
  const [schedule] = await db.query('SELECT * FROM work_schedule WHERE id = 1');
  const s = schedule[0];

  // Get leaves for user if provided
  let leaveMap = {};
  if (userId) {
    const [leaves] = await db.query(
      `SELECT * FROM leaves WHERE user_id = ? AND status = 'approved' AND deleted = 0
       AND from_date <= ? AND to_date >= ?`,
      [userId, endDate, startDate]
    );
    for (const leave of leaves) {
      const leaveStart = new Date(Math.max(new Date(leave.from_date), start));
      const leaveEnd = new Date(Math.min(new Date(leave.to_date), end));
      for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split('T')[0];
        leaveMap[key] = leave.leave_type;
      }
    }
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay();
    const dayName = dayNames[dayOfWeek];
    let dayHours = 0;
    let dayType = 'working';

    // 1. Check holiday
    if (holidayMap[dateStr]) {
      const h = holidayMap[dateStr];
      if (h.holiday_type === 'full_holiday') {
        dayHours = 0;
        dayType = 'holiday';
      } else if (h.holiday_type === 'half_day') {
        dayHours = parseFloat(s.half_day_hours);
        dayType = 'half_day_holiday';
      } else {
        // restricted — treat as normal, fall through
        dayHours = -1; // flag to continue to next check
      }
    }

    // 2. Check weekly override (if not already resolved by holiday)
    if (dayHours === -1 || !holidayMap[dateStr]) {
      const weekStart = getWeekStart(dateStr);
      const override = overrideMap[weekStart];

      if (override) {
        const oType = override[`${dayName}_type`];
        if (oType === 'off') { dayHours = 0; dayType = 'override_off'; }
        else if (oType === 'half') { dayHours = parseFloat(s.half_day_hours); dayType = 'override_half'; }
        else { dayHours = parseFloat(s.full_day_hours); dayType = 'override_full'; }
      } else {
        // 3. Default pattern
        if (dayOfWeek === 6) {
          // Saturday — use pattern
          const satType = resolveSaturdayType(s.saturday_pattern, dateStr);
          if (satType === 'off') { dayHours = 0; dayType = 'weekly_off'; }
          else if (satType === 'half') { dayHours = parseFloat(s.half_day_hours); dayType = 'half_day'; }
          else { dayHours = parseFloat(s.full_day_hours); dayType = 'full_day'; }
        } else {
          const schedType = s[`${dayName}_type`];
          if (schedType === 'off') { dayHours = 0; dayType = 'weekly_off'; }
          else if (schedType === 'half') { dayHours = parseFloat(s.half_day_hours); dayType = 'half_day'; }
          else { dayHours = parseFloat(s.full_day_hours); dayType = 'full_day'; }
        }
      }
    }

    if (dayHours === -1) dayHours = parseFloat(s.full_day_hours); // fallback for restricted holidays

    // Deduct leave
    if (leaveMap[dateStr] && dayHours > 0) {
      if (leaveMap[dateStr] === 'half_day') {
        dayHours = dayHours / 2;
        dayType = 'half_leave';
      } else {
        dayHours = 0;
        dayType = 'on_leave';
      }
    }

    totalExpected += dayHours;
    dailyBreakdown.push({ date: dateStr, expected_hours: dayHours, type: dayType });
  }

  return { totalExpected, dailyBreakdown };
}

// Export helpers for use in other controllers
exports.getExpectedHoursForDate = getExpectedHoursForDate;
exports.getExpectedHoursForRange = getExpectedHoursForRange;

// ─── GET /api/work-schedule ───────────────────────────────────────────────────
exports.getSchedule = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM work_schedule WHERE id = 1');
    if (!rows.length) {
      return res.status(404).json({ message: 'Work schedule not configured' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('Get work schedule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/work-schedule ───────────────────────────────────────────────────
exports.updateSchedule = async (req, res) => {
  try {
    const {
      monday_type, tuesday_type, wednesday_type, thursday_type,
      friday_type, saturday_pattern, sunday_type,
      full_day_hours, half_day_hours, full_day_total, half_day_total,
      lunch_minutes_full, lunch_minutes_half
    } = req.body;

    const fields = [];
    const params = [];

    if (monday_type !== undefined) { fields.push('monday_type = ?'); params.push(monday_type); }
    if (tuesday_type !== undefined) { fields.push('tuesday_type = ?'); params.push(tuesday_type); }
    if (wednesday_type !== undefined) { fields.push('wednesday_type = ?'); params.push(wednesday_type); }
    if (thursday_type !== undefined) { fields.push('thursday_type = ?'); params.push(thursday_type); }
    if (friday_type !== undefined) { fields.push('friday_type = ?'); params.push(friday_type); }
    if (saturday_pattern !== undefined) { fields.push('saturday_pattern = ?'); params.push(saturday_pattern); }
    if (sunday_type !== undefined) { fields.push('sunday_type = ?'); params.push(sunday_type); }
    if (full_day_hours !== undefined) { fields.push('full_day_hours = ?'); params.push(full_day_hours); }
    if (half_day_hours !== undefined) { fields.push('half_day_hours = ?'); params.push(half_day_hours); }
    if (full_day_total !== undefined) { fields.push('full_day_total = ?'); params.push(full_day_total); }
    if (half_day_total !== undefined) { fields.push('half_day_total = ?'); params.push(half_day_total); }
    if (lunch_minutes_full !== undefined) { fields.push('lunch_minutes_full = ?'); params.push(lunch_minutes_full); }
    if (lunch_minutes_half !== undefined) { fields.push('lunch_minutes_half = ?'); params.push(lunch_minutes_half); }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

    await db.query(`UPDATE work_schedule SET ${fields.join(', ')} WHERE id = 1`, params);

    const [updated] = await db.query('SELECT * FROM work_schedule WHERE id = 1');
    return res.json(updated[0]);
  } catch (err) {
    console.error('Update work schedule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/work-schedule/today ─────────────────────────────────────────────
exports.getToday = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const info = await getExpectedHoursForDate(today);
    return res.json(info);
  } catch (err) {
    console.error('Get today schedule error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/work-schedule/week-preview?weeks=4 ──────────────────────────────
// Returns upcoming weeks with auto-calculated schedule (for admin preview)
exports.weekPreview = async (req, res) => {
  try {
    const weeksCount = parseInt(req.query.weeks) || 4;
    const [schedule] = await db.query('SELECT * FROM work_schedule WHERE id = 1');
    const s = schedule[0];

    // Get current week's Monday
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const currentMonday = new Date(now);
    currentMonday.setDate(now.getDate() + mondayOffset);

    const weeks = [];

    for (let w = 0; w < weeksCount; w++) {
      const weekStart = new Date(currentMonday);
      weekStart.setDate(currentMonday.getDate() + (w * 7));
      const weekStartStr = weekStart.toISOString().split('T')[0];

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Check if override exists
      const [overrides] = await db.query('SELECT * FROM weekly_schedule_overrides WHERE week_start = ?', [weekStartStr]);
      const hasOverride = overrides.length > 0;
      const override = overrides[0] || null;

      // Calculate each day
      const days = [];
      const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + d);
        const dayDateStr = dayDate.toISOString().split('T')[0];
        const jsDay = dayDate.getDay(); // 0=Sun...6=Sat
        const dayName = dayNames[d]; // monday=0, ..., sunday=6

        let dayType;
        if (hasOverride) {
          dayType = override[`${dayName}_type`];
        } else if (jsDay === 6) {
          // Saturday — use pattern
          dayType = resolveSaturdayType(s.saturday_pattern, dayDateStr);
        } else if (jsDay === 0) {
          dayType = s.sunday_type;
        } else {
          dayType = s[`${dayName}_type`];
        }

        // Check holiday
        const [hols] = await db.query('SELECT * FROM company_holidays WHERE date = ?', [dayDateStr]);
        const holiday = hols.length > 0 ? hols[0] : null;

        days.push({
          date: dayDateStr,
          day_name: dayName,
          type: holiday ? (holiday.holiday_type === 'full_holiday' ? 'holiday' : 'half_day_holiday') : dayType,
          holiday: holiday ? { title: holiday.title, type: holiday.holiday_type } : null
        });
      }

      weeks.push({
        week_start: weekStartStr,
        week_end: weekEndStr,
        has_override: hasOverride,
        override_reason: override?.reason || null,
        days
      });
    }

    return res.json({ weeks, schedule: s });
  } catch (err) {
    console.error('Week preview error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/work-schedule/override ─────────────────────────────────────────
// Create or update a weekly override
exports.createOverride = async (req, res) => {
  try {
    const {
      week_start, monday_type, tuesday_type, wednesday_type,
      thursday_type, friday_type, saturday_type, sunday_type, reason
    } = req.body;

    if (!week_start) {
      return res.status(400).json({ message: 'week_start is required' });
    }

    // Upsert
    const [existing] = await db.query('SELECT id FROM weekly_schedule_overrides WHERE week_start = ?', [week_start]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE weekly_schedule_overrides SET 
          monday_type = ?, tuesday_type = ?, wednesday_type = ?,
          thursday_type = ?, friday_type = ?, saturday_type = ?, sunday_type = ?,
          reason = ?
         WHERE week_start = ?`,
        [
          monday_type || 'full', tuesday_type || 'full', wednesday_type || 'full',
          thursday_type || 'full', friday_type || 'full', saturday_type || 'half', sunday_type || 'off',
          reason || null, week_start
        ]
      );
    } else {
      await db.query(
        `INSERT INTO weekly_schedule_overrides 
          (week_start, monday_type, tuesday_type, wednesday_type, thursday_type, friday_type, saturday_type, sunday_type, reason, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          week_start,
          monday_type || 'full', tuesday_type || 'full', wednesday_type || 'full',
          thursday_type || 'full', friday_type || 'full', saturday_type || 'half', sunday_type || 'off',
          reason || null, req.user.id
        ]
      );
    }

    const [result] = await db.query('SELECT * FROM weekly_schedule_overrides WHERE week_start = ?', [week_start]);
    return res.json(result[0]);
  } catch (err) {
    console.error('Create override error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/work-schedule/override/:weekStart ─────────────────────────────
// Remove override (revert to default pattern)
exports.deleteOverride = async (req, res) => {
  try {
    const { weekStart } = req.params;
    await db.query('DELETE FROM weekly_schedule_overrides WHERE week_start = ?', [weekStart]);
    return res.json({ message: 'Override removed, reverted to default pattern' });
  } catch (err) {
    console.error('Delete override error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
