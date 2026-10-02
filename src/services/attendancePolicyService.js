const Settings = require('../models/Settings');
const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');

const DEFAULT_SHIFT = {
  code: 'general',
  name: 'General Shift',
  startTime: '09:30',
  endTime: '06:00',
  graceMinutes: 0,
  halfDayMinutes: 240,
  isOvernight: false,
};

function getDayBounds(dateInput = new Date()) {
  const date = new Date(dateInput);
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toDateKey(dateInput) {
  const date = new Date(dateInput);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseTime(text = '09:30') {
  const [h, m] = String(text).split(':').map((v) => Number(v));
  const hours = Number.isFinite(h) ? h : 9;
  const minutes = Number.isFinite(m) ? m : 30;
  return {
    hours: Math.min(23, Math.max(0, hours)),
    minutes: Math.min(59, Math.max(0, minutes)),
  };
}

function combineDateAndTime(dateInput, timeText) {
  const day = getDayBounds(dateInput).start;
  const { hours, minutes } = parseTime(timeText);
  day.setHours(hours, minutes, 0, 0);
  return day;
}

function normalizeShift(raw = {}) {
  return {
    code: String(raw.code || DEFAULT_SHIFT.code).trim() || DEFAULT_SHIFT.code,
    name: String(raw.name || DEFAULT_SHIFT.name).trim() || DEFAULT_SHIFT.name,
    startTime: String(raw.startTime || DEFAULT_SHIFT.startTime),
    endTime: String(raw.endTime || DEFAULT_SHIFT.endTime),
    graceMinutes: Math.max(0, Number(raw.graceMinutes ?? DEFAULT_SHIFT.graceMinutes) || 0),
    halfDayMinutes: Math.max(1, Number(raw.halfDayMinutes ?? DEFAULT_SHIFT.halfDayMinutes) || DEFAULT_SHIFT.halfDayMinutes),
    isOvernight: Boolean(raw.isOvernight),
  };
}

function normalizeMonthlyOffRules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((rule) => ({
      weekOfMonth: Math.min(5, Math.max(1, Math.round(Number(rule?.weekOfMonth)) || 1)),
      dayOfWeek: Math.min(6, Math.max(0, Math.round(Number(rule?.dayOfWeek)) || 0)),
      name: String(rule?.name || '').trim().slice(0, 80),
    }))
    .filter((rule) => Number.isInteger(rule.weekOfMonth) && Number.isInteger(rule.dayOfWeek));
}

function normalizeAttendancePolicy(raw = {}) {
  const shifts = Array.isArray(raw.shifts) && raw.shifts.length
    ? raw.shifts.map((s) => normalizeShift(s))
    : [DEFAULT_SHIFT];

  const defaultShiftCode = raw.defaultShiftCode && shifts.some((s) => s.code === raw.defaultShiftCode)
    ? raw.defaultShiftCode
    : shifts[0].code;

  const weeklyOffDays = Array.isArray(raw.weeklyOffDays)
    ? raw.weeklyOffDays
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [0];

  const holidays = Array.isArray(raw.holidays)
    ? raw.holidays
      .filter((h) => h?.date)
      .map((h) => ({
        name: String(h.name || 'Holiday').trim() || 'Holiday',
        date: getDayBounds(h.date).start,
        optional: Boolean(h.optional),
      }))
    : [];

  return {
    defaultShiftCode,
    shifts,
    weeklyOffDays,
    holidays,
    monthlyOffRules: normalizeMonthlyOffRules(raw.monthlyOffRules),
    autoMarkEnabled: raw.autoMarkEnabled !== false,
    idleTimeoutMinutes: Math.max(1, Math.min(120, Number(raw.idleTimeoutMinutes) || 5)),
  };
}

async function getAttendancePolicy() {
  const settings = await Settings.findOne().select('attendance');
  return normalizeAttendancePolicy(settings?.attendance || {});
}

function resolveUserShift(user, policy) {
  const preferredCode = String(user?.shiftCode || '').trim();
  const shift = policy.shifts.find((s) => s.code === preferredCode)
    || policy.shifts.find((s) => s.code === policy.defaultShiftCode)
    || policy.shifts[0]
    || DEFAULT_SHIFT;
  return normalizeShift(shift);
}

function getShiftWindowForAttendanceDay(attendanceDate, shift) {
  const startAt = combineDateAndTime(attendanceDate, shift.startTime);
  let endAt = combineDateAndTime(attendanceDate, shift.endTime);

  // Roll the end across midnight ONLY when the configured times actually cross
  // midnight (end <= start). A bare isOvernight flag on a shift whose end time
  // is later the same day (e.g. 15:30 -> 23:30 marked overnight) used to create
  // a 32-hour window, which made "yesterday's shift" absorb next-morning
  // clock-ins and mis-date their attendance records (Today card + log empty).
  if (endAt <= startAt) {
    endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
  }

  const lateCutoffAt = new Date(startAt.getTime() + shift.graceMinutes * 60 * 1000);
  return { startAt, endAt, lateCutoffAt };
}

function getAttendanceDayForShift(shift, nowInput = new Date()) {
  const now = new Date(nowInput);
  const today = getDayBounds(now).start;

  if (!shift.isOvernight) {
    return today;
  }

  const { startAt: todayStartAt, endAt: todayEndAt } = getShiftWindowForAttendanceDay(today, shift);
  const previousStartAt = new Date(todayStartAt.getTime() - 24 * 60 * 60 * 1000);
  const previousEndAt = new Date(todayEndAt.getTime() - 24 * 60 * 60 * 1000);

  if (now >= previousStartAt && now <= previousEndAt) {
    return getDayBounds(previousStartAt).start;
  }

  return today;
}

function computeLateInfo(clockInAt, attendanceDate, shift) {
  const clockIn = new Date(clockInAt);
  const { lateCutoffAt } = getShiftWindowForAttendanceDay(attendanceDate, shift);
  const lateMinutes = Math.max(0, Math.ceil((clockIn.getTime() - lateCutoffAt.getTime()) / 60000));
  return {
    isLate: lateMinutes > 0,
    lateMinutes,
    lateCutoffAt,
  };
}

function computeHalfDayInfo(workMinutes, shift) {
  const threshold = Math.max(1, Number(shift?.halfDayMinutes || DEFAULT_SHIFT.halfDayMinutes));
  return {
    isHalfDay: Number(workMinutes || 0) < threshold,
    thresholdMinutes: threshold,
  };
}

function computeEarlyCheckoutInfo(clockOutAt, attendanceDate, shift) {
  const clockOut = new Date(clockOutAt);
  const { endAt } = getShiftWindowForAttendanceDay(attendanceDate, shift);
  const earlyMinutes = Math.max(0, Math.ceil((endAt.getTime() - clockOut.getTime()) / 60000));
  return {
    isEarlyCheckout: earlyMinutes > 0,
    earlyCheckoutMinutes: earlyMinutes,
    shiftEndAt: endAt,
  };
}

function isWeeklyOff(dateInput, policy) {
  const day = new Date(dateInput).getDay();
  return policy.weeklyOffDays.includes(day);
}

// Matches a date against the recurring "nth weekday of the month" off rules.
// weekOfMonth 1-4 = nth occurrence of that weekday in the month, 5 = last
// occurrence (handles months where the 5th occurrence doesn't exist).
// Returns the matching rule or null.
function getMonthlyOffRuleForDate(dateInput, policy) {
  const rules = Array.isArray(policy?.monthlyOffRules) ? policy.monthlyOffRules : [];
  if (rules.length === 0) return null;

  const date = new Date(dateInput);
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const occurrence = Math.ceil(dayOfMonth / 7); // 1st/2nd/3rd/4th/5th of this weekday
  const isLastOccurrence = dayOfMonth + 7 > daysInMonth; // no same weekday later in this month

  return (
    rules.find((rule) => {
      if (rule.dayOfWeek !== dayOfWeek) return false;
      if (Number(rule.weekOfMonth) >= 5) return isLastOccurrence;
      return Number(rule.weekOfMonth) === occurrence;
    }) || null
  );
}

function isMonthlyOff(dateInput, policy) {
  return Boolean(getMonthlyOffRuleForDate(dateInput, policy));
}

function getHolidayForDate(dateInput, policy) {
  const key = toDateKey(dateInput);
  return policy.holidays.find((h) => toDateKey(h.date) === key) || null;
}

function enumerateDays(startDateInput, endDateInput) {
  const start = getDayBounds(startDateInput).start;
  const end = getDayBounds(endDateInput).start;
  const days = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    days.push(new Date(d));
  }
  return days;
}

// Half-day leave types are stored as 'half_day' (legacy: 'Half-Day', 'Half
// Day', 'halfday'). Approved half-day leaves must be materialised as
// `half_day` attendance records so the dashboard's "Half Days" box counts
// them (a full-day leave stays as `leave` and feeds the "On Leave" box).
function isHalfDayLeaveType(rawType = '') {
  const key = String(rawType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return key === 'half_day' || key === 'halfday';
}

async function buildApprovedLeaveDayMap(userIds, startDate, endDate) {
  const rows = await LeaveRequest.find({
    user: { $in: userIds },
    status: 'approved',
    startDate: { $lte: getDayBounds(endDate).end },
    endDate: { $gte: getDayBounds(startDate).start },
  }).select('user startDate endDate _id leaveType totalDays');

  const leaveMap = new Map();
  for (const row of rows) {
    const userId = String(row.user);
    const halfDay = isHalfDayLeaveType(row.leaveType) || Number(row.totalDays) === 0.5;
    const days = enumerateDays(row.startDate, row.endDate);
    for (const day of days) {
      const key = `${userId}:${toDateKey(day)}`;
      if (!leaveMap.has(key)) {
        leaveMap.set(key, { leaveRequest: String(row._id), halfDay });
      }
    }
  }
  return leaveMap;
}

function deriveAutoStatus({ day, policy, leaveMap, userId }) {
  const holiday = getHolidayForDate(day, policy);
  const monthlyOff = getMonthlyOffRuleForDate(day, policy);
  if (holiday || isWeeklyOff(day, policy) || monthlyOff) {
    return {
      status: 'holiday',
      isHoliday: true,
      holidayName: holiday?.name || monthlyOff?.name || 'Weekly Off',
      isOnLeave: false,
      isAbsent: false,
      isHalfDay: false,
      leaveRequest: null,
    };
  }

  const leaveEntry = leaveMap.get(`${userId}:${toDateKey(day)}`) || null;
  if (leaveEntry) {
    const leaveRequestId = typeof leaveEntry === 'string' ? leaveEntry : leaveEntry.leaveRequest;
    const halfDay = typeof leaveEntry === 'object' && Boolean(leaveEntry.halfDay);
    return {
      // Approved half-day leave -> 'half_day' so it lands in the "Half Days"
      // box; a full-day leave -> 'leave' (the "On Leave" box).
      status: halfDay ? 'half_day' : 'leave',
      isHoliday: false,
      holidayName: '',
      isOnLeave: true,
      isAbsent: false,
      isHalfDay: halfDay,
      leaveRequest: leaveRequestId,
    };
  }

  return {
    status: 'absent',
    isHoliday: false,
    holidayName: '',
    isOnLeave: false,
    isAbsent: true,
    isHalfDay: false,
    leaveRequest: null,
  };
}

async function reconcileMissingAttendanceRecords({
  users,
  startDate,
  endDate,
  actedBy = null,
}) {
  if (!Array.isArray(users) || users.length === 0) {
    return { created: 0, updated: 0, scannedDays: 0 };
  }

  const policy = await getAttendancePolicy();
  if (!policy.autoMarkEnabled) {
    return { created: 0, updated: 0, scannedDays: 0, skipped: true };
  }

  const todayStart = getDayBounds().start;
  let start = getDayBounds(startDate).start;
  let end = getDayBounds(endDate).start;

  if (end >= todayStart) {
    end = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  }
  if (start > end) {
    return { created: 0, updated: 0, scannedDays: 0 };
  }

  const days = enumerateDays(start, end);
  const userIds = users.map((u) => u._id);
  const existing = await AttendanceRecord.find({
    user: { $in: userIds },
    attendanceDate: { $gte: start, $lte: getDayBounds(end).end },
  }).select('user attendanceDate clockInAt status isAbsent isOnLeave isHoliday holidayName leaveRequest');

  const existingMap = new Map();
  for (const row of existing) {
    existingMap.set(`${String(row.user)}:${toDateKey(row.attendanceDate)}`, row);
  }

  const leaveMap = await buildApprovedLeaveDayMap(userIds, start, end);
  let created = 0;
  let updated = 0;

  for (const user of users) {
    const shift = resolveUserShift(user, policy);
    for (const day of days) {
      const dayKey = `${String(user._id)}:${toDateKey(day)}`;
      const existingRecord = existingMap.get(dayKey);
      if (existingRecord?.clockInAt) continue;

      const desired = deriveAutoStatus({
        day,
        policy,
        leaveMap,
        userId: String(user._id),
      });

      if (!existingRecord) {
        await AttendanceRecord.create({
          user: user._id,
          attendanceDate: getDayBounds(day).start,
          status: desired.status,
          isLate: false,
          isHalfDay: Boolean(desired.isHalfDay),
          lateMinutes: 0,
          isEarlyCheckout: false,
          earlyCheckoutMinutes: 0,
          shiftCode: shift.code,
          shiftName: shift.name,
          isAbsent: desired.isAbsent,
          isOnLeave: desired.isOnLeave,
          leaveRequest: desired.leaveRequest,
          isHoliday: desired.isHoliday,
          holidayName: desired.holidayName,
          note: desired.status === 'absent' ? 'Auto marked: no clock-in found' : '',
          createdBy: actedBy,
          updatedBy: actedBy,
        });
        created += 1;
        continue;
      }

      const changed = (
        existingRecord.status !== desired.status
        || Boolean(existingRecord.isAbsent) !== desired.isAbsent
        || Boolean(existingRecord.isOnLeave) !== desired.isOnLeave
        || Boolean(existingRecord.isHalfDay) !== Boolean(desired.isHalfDay)
        || Boolean(existingRecord.isHoliday) !== desired.isHoliday
        || String(existingRecord.holidayName || '') !== String(desired.holidayName || '')
        || String(existingRecord.leaveRequest || '') !== String(desired.leaveRequest || '')
      );

      if (changed) {
        existingRecord.status = desired.status;
        existingRecord.isAbsent = desired.isAbsent;
        existingRecord.isOnLeave = desired.isOnLeave;
        existingRecord.isHalfDay = Boolean(desired.isHalfDay);
        existingRecord.isHoliday = desired.isHoliday;
        existingRecord.holidayName = desired.holidayName;
        existingRecord.leaveRequest = desired.leaveRequest;
        existingRecord.updatedBy = actedBy;
        await existingRecord.save();
        updated += 1;
      }
    }
  }

  return { created, updated, scannedDays: days.length * users.length };
}

function calculateLeaveDayCount(startDate, endDate, policy) {
  const days = enumerateDays(startDate, endDate);
  let total = 0;
  for (const day of days) {
    if (isWeeklyOff(day, policy) || isMonthlyOff(day, policy)) continue;
    if (getHolidayForDate(day, policy)) continue;
    total += 1;
  }
  return Math.max(0.5, total || 1);
}

module.exports = {
  getDayBounds,
  toDateKey,
  getAttendancePolicy,
  resolveUserShift,
  getAttendanceDayForShift,
  getShiftWindowForAttendanceDay,
  computeLateInfo,
  computeHalfDayInfo,
  computeEarlyCheckoutInfo,
  enumerateDays,
  isWeeklyOff,
  getMonthlyOffRuleForDate,
  isMonthlyOff,
  getHolidayForDate,
  deriveAutoStatus,
  calculateLeaveDayCount,
  reconcileMissingAttendanceRecords,
};
