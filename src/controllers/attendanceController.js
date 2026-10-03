const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const Settings = require('../models/Settings');
const {
  getDayBounds,
  toDateKey,
  enumerateDays,
  getAttendancePolicy,
  resolveUserShift,
  getAttendanceDayForShift,
  computeLateInfo,
  computeHalfDayInfo,
  computeEarlyCheckoutInfo,
  isWeeklyOff,
  getMonthlyOffRuleForDate,
  getHolidayForDate,
  calculateLeaveDayCount,
  reconcileMissingAttendanceRecords,
} = require('../services/attendancePolicyService');
const { notifyUser, notifyMany } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');

// Leave type helpers ────────────────────────────────────────────────────────
// The UI/database may hold legacy spellings ('Half-Day', 'Personal Resion').
// Everything is normalized to a canonical snake_case value so counting and
// email rendering stay predictable.
const LEAVE_TYPE_LABELS = {
  annual: 'Annual Leave',
  sick: 'Sick Leave',
  casual: 'Casual Leave',
  half_day: 'Half Day Leave',
  personal: 'Personal Leave',
  unpaid: 'Unpaid Leave',
  other: 'Other',
};

function normalizeLeaveType(rawType = '') {
  const key = String(rawType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (key === 'half_day' || key === 'halfday') return 'half_day';
  if (key === 'personal_resion' || key === 'personal_reason' || key === 'personal') return 'personal';
  if (LEAVE_TYPE_LABELS[key]) return key;
  return 'other';
}

function isHalfDayLeaveType(rawType = '') {
  return normalizeLeaveType(rawType) === 'half_day';
}

function leaveTypeLabel(rawType = '') {
  return LEAVE_TYPE_LABELS[normalizeLeaveType(rawType)] || 'Leave';
}

function formatLongDate(dateInput) {
  return new Date(dateInput).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Email bodies are HTML, so every dynamic value (employee name, role, the
// free-text reason a user types) has to be escaped. Without this a single "<"
// in the reason breaks the markup, and unescaped text is an injection vector.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Renders free text for an HTML table cell: escaped, with newlines kept as
// line breaks so a multi-line reason stays readable in the mail client.
function htmlTextBlock(value, fallback = '<em>Not specified</em>') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return escapeHtml(raw).replace(/\r?\n/g, '<br>');
}

// Emails the employee the outcome of their leave request, including the
// reviewer's rejection reason. Never throws - a mail failure must not break the
// review itself.
async function sendLeaveReviewEmail({ leave, status, decisionLabel, reviewerLine, typeLabel, noteText }) {
  try {
    const requester = await User.findById(leave.user).select('name email role');
    if (!requester?.email) return;

    const settings = await Settings.findOne().lean();
    const company = settings?.branding?.appName || settings?.companyName || 'CRM Pro';
    const statusColor = status === 'approved' ? '#16a34a' : status === 'rejected' ? '#dc2626' : '#6b7280';
    const noteLabel = status === 'rejected' ? 'Reason for rejection' : 'Reviewer note';
    const plainNote = noteText || 'No reason provided.';
    const startLabel = formatLongDate(leave.startDate);
    const endLabel = formatLongDate(leave.endDate);
    const reviewedLabel = formatLongDate(new Date());

    // HTML-safe variants for the markup below (the plain-text body keeps the
    // raw values so it stays readable in any client).
    const htmlRequesterName = escapeHtml(requester.name);
    const htmlReviewerLine = escapeHtml(reviewerLine);
    const htmlTypeLabel = escapeHtml(typeLabel);
    const htmlStatusColor = escapeHtml(statusColor);

    const text = [
      '============================================================',
      `           LEAVE REQUEST ${decisionLabel.toUpperCase()}`,
      '============================================================',
      '',
      `Employee:      ${requester.name} (${requester.role})`,
      `Company:       ${company}`,
      '',
      '------------------------------------------------------------',
      '                          DETAILS',
      '------------------------------------------------------------',
      '',
      `Leave Type:    ${typeLabel}`,
      `Start Date:    ${startLabel}`,
      `End Date:      ${endLabel}`,
      `Total Days:    ${leave.totalDays} day(s)`,
      `Status:        ${decisionLabel.toUpperCase()}`,
      '',
      `Reviewed By:   ${reviewerLine}`,
      `Reviewed On:   ${reviewedLabel}`,
      '',
      `${noteLabel}:`,
      plainNote,
      '',
      '============================================================',
      `This is an automated notification from ${company}.`,
      'Please do not reply to this email.',
      '============================================================',
    ].join('\n');

    const html = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: ${statusColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .header h1 { margin: 0; font-size: 22px; }
                .content { background: #f9f9f9; padding: 25px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; }
                .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .info-table td { padding: 12px 15px; border-bottom: 1px solid #e0e0e0; }
                .info-table td:first-child { font-weight: bold; width: 150px; color: #555; background: #f0f0f0; }
                .note { background: #fff; border-left: 4px solid ${statusColor}; padding: 12px 16px; margin-top: 10px; }
                .footer { text-align: center; margin-top: 25px; padding-top: 15px; border-top: 1px solid #e0e0e0; color: #888; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>Leave Request ${escapeHtml(decisionLabel)}</h1>
              </div>
              <div class="content">
                <p>Hello ${htmlRequesterName},</p>
                <p>Your leave request has been <strong>${escapeHtml(decisionLabel.toLowerCase())}</strong> by ${htmlReviewerLine}.</p>

                <table class="info-table">
                  <tr><td>Leave Type</td><td><strong>${htmlTypeLabel}</strong></td></tr>
                  <tr><td>Start Date</td><td>${escapeHtml(startLabel)}</td></tr>
                  <tr><td>End Date</td><td>${escapeHtml(endLabel)}</td></tr>
                  <tr><td>Total Days</td><td><strong>${escapeHtml(leave.totalDays)} day(s)</strong></td></tr>
                  <tr><td>Status</td><td><strong style="color:${htmlStatusColor}">${escapeHtml(decisionLabel.toUpperCase())}</strong></td></tr>
                  <tr><td>Reviewed By</td><td>${htmlReviewerLine}</td></tr>
                  <tr><td>Reviewed On</td><td>${escapeHtml(reviewedLabel)}</td></tr>
                </table>

                <p><strong>${escapeHtml(noteLabel)}:</strong></p>
                <div class="note">${htmlTextBlock(plainNote)}</div>
              </div>
              <div class="footer">
                <p>This is an automated notification from <strong>${escapeHtml(company)}</strong></p>
                <p>Please do not reply to this email.</p>
              </div>
            </body>
            </html>
          `;

    const result = await sendEmail({
      to: requester.email,
      subject: `[${company}] Leave Request ${decisionLabel}: ${typeLabel}`,
      text,
      html,
    });

    // Track the outcome email on the request so Admin/HR can audit every
    // message that was sent for it.
    leave.emailSentTo = [
      ...(leave.emailSentTo || []),
      {
        recipient: requester._id,
        email: requester.email,
        sentAt: new Date(),
        delivered: !!result?.sent,
        ...(result?.sent ? {} : { failureReason: result?.reason || 'unknown_error' }),
      },
    ];
    await leave.save();
  } catch (mailErr) {
    console.error('Leave review email failed:', mailErr.message);
  }
}

// Confirms to the employee that their request was received, so they have a
// record of what was submitted. Never throws - a mail failure must not break
// the request itself.
async function sendLeaveRequestConfirmationEmail({ requester, typeLabel, startLabel, endLabel, totalDays, reason }) {
  try {
    const settings = await Settings.findOne().lean();
    const company = settings?.branding?.appName || settings?.companyName || 'CRM Pro';
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

    const text = [
      '============================================================',
      '        LEAVE REQUEST RECEIVED - PENDING APPROVAL',
      '============================================================',
      '',
      `Employee:      ${requester.name} (${requester.role})`,
      `Company:       ${company}`,
      '',
      '------------------------------------------------------------',
      '                          DETAILS',
      '------------------------------------------------------------',
      '',
      `Leave Type:    ${typeLabel}`,
      `Start Date:    ${startLabel}`,
      `End Date:      ${endLabel}`,
      `Total Days:    ${totalDays} day(s)`,
      'Status:        PENDING APPROVAL',
      '',
      'Reason:',
      reason || 'Not specified',
      '',
      '------------------------------------------------------------',
      '                     WHAT HAPPENS NEXT',
      '------------------------------------------------------------',
      '',
      'Your request has been forwarded to HR / Admin for approval.',
      'You will receive another email as soon as it is approved or rejected.',
      `You can track the status here: ${frontendUrl}/attendance/leaves`,
      '',
      '============================================================',
      `This is an automated notification from ${company}.`,
      'Please do not reply to this email.',
      '============================================================',
    ].join('\n');

    const html = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .header h1 { margin: 0; font-size: 22px; }
                .content { background: #f9f9f9; padding: 25px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; }
                .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .info-table td { padding: 12px 15px; border-bottom: 1px solid #e0e0e0; }
                .info-table td:first-child { font-weight: bold; width: 150px; color: #555; background: #f0f0f0; }
                .status { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: bold; }
                .note { background: #fff; border-left: 4px solid #2563eb; padding: 12px 16px; margin-top: 10px; }
                .footer { text-align: center; margin-top: 25px; padding-top: 15px; border-top: 1px solid #e0e0e0; color: #888; font-size: 12px; }
                .link-btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 15px; }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>Leave Request Received</h1>
                <p>Your request has been submitted</p>
              </div>
              <div class="content">
                <p>Hello ${escapeHtml(requester.name)},</p>
                <p>Your leave request has been recorded and forwarded to HR / Admin for approval.</p>

                <table class="info-table">
                  <tr><td>Leave Type</td><td><strong>${escapeHtml(typeLabel)}</strong></td></tr>
                  <tr><td>Start Date</td><td>${escapeHtml(startLabel)}</td></tr>
                  <tr><td>End Date</td><td>${escapeHtml(endLabel)}</td></tr>
                  <tr><td>Total Days</td><td><strong>${escapeHtml(totalDays)} day(s)</strong></td></tr>
                  <tr><td>Reason</td><td>${htmlTextBlock(reason)}</td></tr>
                </table>

                <div style="text-align: center;">
                  <span class="status">&#128274; Pending Approval</span>
                </div>

                <div style="margin-top: 20px;">
                  <p><strong>What happens next?</strong></p>
                  <p style="margin-bottom: 0;">Your approver will review the request, and you will receive another
                  email as soon as it is approved or rejected.</p>
                </div>

                <div style="text-align: center;">
                  <a class="link-btn" href="${escapeHtml(frontendUrl)}/attendance/leaves">View My Leave Requests</a>
                </div>
              </div>
              <div class="footer">
                <p>This is an automated notification from <strong>${escapeHtml(company)}</strong></p>
                <p>Please do not reply to this email.</p>
              </div>
            </body>
            </html>
          `;

    return await sendEmail({
      to: requester.email,
      subject: `[${company}] Leave Request Received: ${typeLabel}`,
      text,
      html,
    });
  } catch (err) {
    console.error('Leave request confirmation email failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

const ALLOWED_OVERVIEW_ROLES = ['super_admin', 'admin', 'hr'];

function canViewAllAttendance(user) {
  return ALLOWED_OVERVIEW_ROLES.includes(user?.role);
}

// ─── Late check-in approval workflow ─────────────────────────────────────────
// Every role except super_admin must provide a reason when clocking in after
// shift start + grace. The record goes to status 'pending' until reviewed.
//
// Approval routing (based on the requester's role):
//   team_lead / team_member / member / others -> super_admin, admin, hr, manager
//   hr / manager                              -> super_admin, admin
//   admin                                     -> super_admin
//   super_admin                               -> never requires approval
const LATE_APPROVAL_EXEMPT_ROLES = ['super_admin'];

function isLateApprovalRequired(user) {
  return !LATE_APPROVAL_EXEMPT_ROLES.includes(user?.role);
}

function getApproversForRequester(requesterRole = '') {
  if (requesterRole === 'admin') return ['super_admin'];
  if (requesterRole === 'hr' || requesterRole === 'manager') return ['super_admin', 'admin'];
  return ['super_admin', 'admin', 'hr', 'manager'];
}

function canApproveLateCheckIn(approverRole, requesterRole) {
  if (approverRole === 'super_admin') return true;
  return getApproversForRequester(requesterRole).includes(approverRole);
}

function formatApprovalDate(dateInput) {
  return new Date(dateInput).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function notifyLateCheckInApprovers({ requester, record, lateMinutes }) {
  const approverRoles = getApproversForRequester(requester.role);
  const approvers = await User.find({
    role: { $in: approverRoles },
    isActive: true,
    _id: { $ne: requester._id },
  }).select('_id');
  if (!approvers.length) return;

  const dateLabel = formatApprovalDate(record.attendanceDate);
  await notifyMany(
    approvers.map((approver) => ({
      recipientId: approver._id,
      senderId: requester._id,
      type: 'late_checkin_pending',
      title: 'Late check-in needs approval',
      message: `${requester.name} (${requester.role}) clocked in ${lateMinutes} min late on ${dateLabel}. Reason: ${record.lateReason}`,
      link: '/attendance',
    }))
  );
}
// ─── Leave request notifications ─────────────────────────────────────────────
// Roles that can action a leave request. Mirrors the audience used for the
// leave emails so in-app and email notifications reach the same people.
const LEAVE_APPROVER_ROLES = ['super_admin', 'admin', 'hr'];

// Tells every active approver that a leave request is waiting for them. The
// requester is excluded so HR/Admin never queue a request for their own leave.
// Email delivery is optional here (SMTP may not be configured) - the in-app
// notification is the guaranteed channel, so it fires regardless of settings.
async function notifyLeaveApprovers({ requester, leave, typeLabel, periodLabel, totalDays, reason }) {
  const approvers = await User.find({
    role: { $in: LEAVE_APPROVER_ROLES },
    isActive: true,
    _id: { $ne: requester._id },
  }).select('_id');
  if (!approvers.length) return;

  await notifyMany(
    approvers.map((approver) => ({
      recipientId: approver._id,
      senderId: requester._id,
      type: 'leave_requested',
      title: 'New leave request needs approval',
      message:
        `${requester.name} (${requester.role}) requested ${typeLabel} for ${periodLabel} (${totalDays} day(s)).` +
        (reason ? ` Reason: ${reason}` : ''),
      link: '/attendance/leaves',
    }))
  );
}

// ─────────────────────────────────────────────────────────────────────────────

async function findTodayRecord(userId) {
  // Shift-aligned lookup: overnight shifts can attribute a clock-in (e.g. just
  // after midnight) to the PREVIOUS attendance day, so the record's
  // attendanceDate may not be the plain calendar day. Try the shift-aware day
  // first (the exact day clockIn/clockOut write), then fall back to the
  // calendar day so legacy records still surface. Without this, a night-shift
  // user's Today card kept showing "Clock In" after a successful clock-in.
  const { start, end } = getDayBounds();
  const populate = [
    { path: 'user', select: 'name email avatar role department shiftCode' },
    { path: 'leaveRequest', select: 'leaveType status startDate endDate' },
  ];
  try {
    const targetUser = await User.findById(userId).select('shiftCode');
    if (targetUser) {
      const policy = await getAttendancePolicy();
      const shift = resolveUserShift(targetUser, policy);
      const shiftDay = getAttendanceDayForShift(shift, new Date());
      const byShiftDay = await AttendanceRecord
        .findOne({ user: userId, attendanceDate: shiftDay })
        .populate(populate);
      if (byShiftDay) return byShiftDay;
    }
  } catch (shiftLookupErr) {
    console.error('findTodayRecord shift-aligned lookup failed:', shiftLookupErr.message);
  }
  return AttendanceRecord
    .findOne({ user: userId, attendanceDate: { $gte: start, $lte: end } })
    .populate(populate);
}

async function buildSummary(query, todayRecord) {
  const aggregate = await AttendanceRecord.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        presentCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$isAbsent', true] },
                  { $ne: ['$isOnLeave', true] },
                  { $ne: ['$isHoliday', true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        lateCount: { $sum: { $cond: [{ $eq: ['$isLate', true] }, 1, 0] } },
        // Half-day leave days are flagged with BOTH isHalfDay and isOnLeave so
        // they show in the "Half Days" box; leaveCount therefore excludes them
        // to keep the two boxes from double-counting the same day.
        halfDayCount: { $sum: { $cond: [{ $eq: ['$isHalfDay', true] }, 1, 0] } },
        absentCount: { $sum: { $cond: [{ $eq: ['$isAbsent', true] }, 1, 0] } },
        leaveCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$isOnLeave', true] }, { $ne: ['$isHalfDay', true] }] },
              1,
              0,
            ],
          },
        },
        // holidayCount is computed from the policy (unique holidays in range), not here
        remoteCount: { $sum: { $cond: [{ $eq: ['$status', 'remote'] }, 1, 0] } },
        totalMinutes: { $sum: '$workMinutes' },
      },
    },
  ]);

  const metrics = aggregate[0] || {
    totalRecords: 0,
    presentCount: 0,
    lateCount: 0,
    halfDayCount: 0,
    absentCount: 0,
    leaveCount: 0,
    holidayCount: 0,
    remoteCount: 0,
    totalMinutes: 0,
  };

  return {
    ...metrics,
    totalHours: Number((metrics.totalMinutes / 60).toFixed(1)),
    todayRecord: todayRecord || null,
    todayStatus: todayRecord?.status || (todayRecord?.clockInAt ? 'present' : 'not_clocked_in'),
  };
}

// @GET /api/attendance
exports.getAttendanceRecords = async (req, res) => {
  try {
    const { user, startDate, endDate, page = 1, limit = 100, autoMark = 'true' } = req.query;
    const query = {};
    const elevated = canViewAllAttendance(req.user);

    const { start: defaultStart } = getDayBounds();
    defaultStart.setDate(1);
    const rangeStart = startDate ? getDayBounds(new Date(startDate)).start : defaultStart;
    const rangeEnd = endDate ? getDayBounds(new Date(endDate)).end : getDayBounds().end;

    if (!elevated) {
      query.user = req.user._id;
    } else if (user) {
      query.user = user;
    }

    query.attendanceDate = { $gte: rangeStart, $lte: rangeEnd };

    if (autoMark !== 'false') {
      const users = !elevated
        ? [req.user]
        : user
          ? await User.find({ _id: user, isActive: true }).select('_id shiftCode role')
          : await User.find({ isActive: true }).select('_id shiftCode role');
      await reconcileMissingAttendanceRecords({
        users,
        startDate: rangeStart,
        endDate: rangeEnd,
        actedBy: req.user._id,
      });
    }

    const todayRecord = elevated && user ? await findTodayRecord(user) : await findTodayRecord(req.user._id);
    const [records, summary] = await Promise.all([
      AttendanceRecord.find(query)
        .populate('user', 'name email avatar role department shiftCode')
        .populate('leaveRequest', 'leaveType status startDate endDate')
        .populate('createdBy', 'name email role')
        .populate('updatedBy', 'name email role')
        .populate('lateReviewedBy', 'name email role')
        .sort({ attendanceDate: -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      buildSummary(query, todayRecord),
    ]);

    // Compute holidayCount from the policy (unique holiday dates in range),
    // not from attendance records (which creates one record per user per
    // holiday, causing the count to multiply when all users are selected).
    // Monthly off rules (e.g. 2nd Saturday off) are counted too — a date Set
    // keeps fixed holidays and monthly-off days from being double-counted.
    // Regular weekly off days are still not counted (unchanged behavior).
    const policy = await getAttendancePolicy();
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();
    const holidayDateKeys = new Set();
    for (const h of policy.holidays || []) {
      const hMs = new Date(h.date).getTime();
      if (hMs >= rangeStartMs && hMs <= rangeEndMs) holidayDateKeys.add(toDateKey(h.date));
    }
    if ((policy.monthlyOffRules || []).length > 0) {
      for (const day of enumerateDays(rangeStart, rangeEnd)) {
        if (isWeeklyOff(day, policy)) continue;
        if (getMonthlyOffRuleForDate(day, policy)) holidayDateKeys.add(toDateKey(day));
      }
    }
    summary.holidayCount = holidayDateKeys.size;

    res.json({ success: true, records, summary, total: records.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/attendance/clock-in
exports.clockIn = async (req, res) => {
  try {
    const { note = '', lateReason = '' } = req.body;

    // Admins and Super Admins do not need to perform check-in;
    // they manage attendance for others. Block them from clocking in.
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Admins and Super Admins cannot perform check-in. This action is reserved for non-administrative roles.',
      });
    }

    const policy = await getAttendancePolicy();
    const shift = resolveUserShift(req.user, policy);
    const attendanceDate = getAttendanceDayForShift(shift, new Date());
    const existing = await AttendanceRecord.findOne({ user: req.user._id, attendanceDate });

    if (existing?.clockInAt) {
      // Idempotent double-click: return the existing record instead of an
      // error so the UI syncs to the current state (Clock Out / Pending)
      // instead of showing a confusing "already clocked in" popup.
      const populatedExisting = await AttendanceRecord.findById(existing._id)
        .populate('user', 'name email avatar role department shiftCode')
        .populate('leaveRequest', 'leaveType status startDate endDate')
        .populate('createdBy', 'name email role')
        .populate('updatedBy', 'name email role')
        .populate('lateReviewedBy', 'name email role');
      return res.json({ success: true, alreadyClockedIn: true, record: populatedExisting });
    }

    const clockInAt = new Date();
    const lateInfo = computeLateInfo(clockInAt, attendanceDate, shift);

    // Late check-in (after shift start + grace) requires a reason from every
    // role except Super Admin, and the record stays 'pending' until reviewed.
    const needsLateApproval = lateInfo.isLate && isLateApprovalRequired(req.user);
    const trimmedReason = String(lateReason || '').trim();
    if (needsLateApproval && !trimmedReason) {
      return res.status(400).json({
        success: false,
        message: `You are ${lateInfo.lateMinutes} minute(s) late. Please provide the reason for your delayed check-in.`,
        code: 'LATE_REASON_REQUIRED',
        lateMinutes: lateInfo.lateMinutes,
        shiftName: shift.name,
      });
    }

    const record = existing || new AttendanceRecord({
      user: req.user._id,
      attendanceDate,
      createdBy: req.user._id,
    });

    record.clockInAt = clockInAt;
    record.clockOutAt = existing?.clockOutAt || null;
    record.note = note || record.note;
    record.shiftCode = shift.code;
    record.shiftName = shift.name;
    record.isLate = lateInfo.isLate;
    record.lateMinutes = lateInfo.lateMinutes;
    record.isHalfDay = false;
    record.isEarlyCheckout = false;
    record.earlyCheckoutMinutes = 0;
    record.isAbsent = false;
    record.isOnLeave = false;
    record.leaveRequest = null;
    record.isHoliday = false;
    record.holidayName = '';
    if (needsLateApproval) {
      record.status = 'pending';
      record.lateReason = trimmedReason.slice(0, 500);
      record.lateApprovalStatus = 'pending';
    } else {
      record.status = lateInfo.isLate ? 'late' : 'present';
      record.lateReason = '';
      record.lateApprovalStatus = null;
    }
    record.lateReviewedBy = null;
    record.lateReviewedAt = null;
    record.lateReviewNote = '';
    record.updatedBy = req.user._id;

    await record.save();

    const populated = await AttendanceRecord.findById(record._id)
      .populate('user', 'name email avatar role department shiftCode')
      .populate('leaveRequest', 'leaveType status startDate endDate')
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .populate('lateReviewedBy', 'name email role');

    // Send the late reason to the eligible approvers (Admin/HR/Manager for
    // regular staff; Super Admin/Admin when the requester is HR or Manager).
    if (needsLateApproval) {
      await notifyLateCheckInApprovers({
        requester: req.user,
        record,
        lateMinutes: lateInfo.lateMinutes,
      });
    }

    res.status(201).json({ success: true, record: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/attendance/clock-out
exports.clockOut = async (req, res) => {
  try {
    const { note = '', workedMs } = req.body;

    // Admins and Super Admins do not perform check-in/check-out;
    // they manage attendance for others. Block them from clocking out.
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Admins and Super Admins cannot perform clock-out. This action is reserved for non-administrative roles.',
      });
    }

    const policy = await getAttendancePolicy();
    const shift = resolveUserShift(req.user, policy);
    const attendanceDate = getAttendanceDayForShift(shift, new Date());
    const record = await AttendanceRecord.findOne({ user: req.user._id, attendanceDate });

    if (!record || !record.clockInAt) {
      return res.status(400).json({ success: false, message: 'Clock in first before clocking out' });
    }

    // Keep the late-approval workflow intact: while a late check-in is still
    // awaiting review, Clock Out is blocked (the UI hides the button too) so
    // the "Pending Approval -> approve -> Clock Out" flow cannot be bypassed.
    if (record.lateApprovalStatus === 'pending' && record.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your late check-in is awaiting approval. You can clock out once it is approved.',
        code: 'LATE_APPROVAL_PENDING',
      });
    }

    // if (record.clockOutAt) {
    //   return res.status(400).json({ success: false, message: 'You have already clocked out today' });
    // }

    // const clockOutAt = new Date();
    const clockOutAt =record.clockOutAt || new Date();
    // Prefer the actual tracked time from the desktop Activity Tracker app.
    // If no workedMs is provided (e.g. web UI clock-out) but the desktop app
    // has already reported live tracked time, keep that as the source of
    // truth instead of falling back to wall-clock (which includes idle/paused
    // periods). Only fall back to wall-clock when no tracked time exists.
    const workedDurationMs = workedMs != null
      ? Math.max(0, Number(workedMs))
      : (record.workedMs > 0
          ? Math.max(0, Number(record.workedMs))
          : Math.max(0, clockOutAt.getTime() - new Date(record.clockInAt).getTime()));
    const workMinutes = Math.round(workedDurationMs / 60000);
 
    // const workMinutes = Math.max(0, Math.round((clockOutAt.getTime() - new Date(record.clockInAt).getTime()) / 60000));
    const halfDayInfo = computeHalfDayInfo(workMinutes, shift);
    const earlyCheckout = computeEarlyCheckoutInfo(clockOutAt, attendanceDate, shift);

    record.clockOutAt = clockOutAt;
    record.workMinutes = workMinutes;
    record.workedMs = workedDurationMs;
    record.workedHours = Math.round((workedDurationMs / 3600000) * 100) / 100;
    record.note = note || record.note;
    record.shiftCode = shift.code;
    record.shiftName = shift.name;
    record.isHalfDay = halfDayInfo.isHalfDay;
    record.isEarlyCheckout = earlyCheckout.isEarlyCheckout;
    record.earlyCheckoutMinutes = earlyCheckout.earlyCheckoutMinutes;
    // Keep the late-approval pending state intact until a reviewer decides;
    // clocking out must not silently resolve a pending late check-in.
    record.status = record.lateApprovalStatus === 'pending'
      ? 'pending'
      : record.isHalfDay
        ? 'half_day'
        : record.isLate
          ? 'late'
          : 'present';
    record.updatedBy = req.user._id;

    await record.save();

    const populated = await AttendanceRecord.findById(record._id)
      .populate('user', 'name email avatar role department shiftCode')
      .populate('leaveRequest', 'leaveType status startDate endDate')
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role');

    res.json({ success: true, record: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/attendance/today/worked
exports.updateLiveWorkedTime = async (req, res) => {
  try {
    const { workedMs } = req.body;
    if (workedMs == null) {
      return res.status(400).json({ success: false, message: 'workedMs is required' });
    }

    const policy = await getAttendancePolicy();
    const shift = resolveUserShift(req.user, policy);
    const attendanceDate = getAttendanceDayForShift(shift, new Date());
    const record = await AttendanceRecord.findOne({ user: req.user._id, attendanceDate });

    if (!record || !record.clockInAt) {
      return res.status(400).json({ success: false, message: 'Clock in first before reporting worked time' });
    }

    // Live idle-adjusted worked time reported by the desktop Activity Tracker
    // app. This is the source of truth for working hours while the day is
    // still in progress (before clock-out), so the UI shows the actual
    // tracked time rather than wall-clock (which includes idle/paused time).
    const incomingWorkedMs = Math.max(0, Number(workedMs));
    // Guard against client restarts/re-logins sending a smaller value.
    // Live worked time should be monotonic while the user remains checked in.
    const workedDurationMs = Math.max(0, Number(record.workedMs || 0), incomingWorkedMs);
    record.workMinutes = Math.round(workedDurationMs / 60000);
    record.workedMs = workedDurationMs;
    record.workedHours = Math.round((workedDurationMs / 3600000) * 100) / 100;
    record.updatedBy = req.user._id;

    await record.save();

    const populated = await AttendanceRecord.findById(record._id)
      .populate('user', 'name email avatar role department shiftCode')
      .populate('leaveRequest', 'leaveType status startDate endDate')
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role');

    res.json({ success: true, record: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/attendance/today
exports.getTodayAttendance = async (req, res) => {
  try {
    const elevated = canViewAllAttendance(req.user);
    const userId = elevated && req.query.user ? req.query.user : req.user._id;
    const record = await findTodayRecord(userId);
    const todayRecord = record ? record.toObject() : null;
    if (todayRecord && todayRecord.clockInAt && !todayRecord.clockOutAt) {
      // Live worked duration for an in-progress day (wall-clock) so the
      // desktop app / UI can show current progress before clock-out.
      const liveMs = Math.max(0, Date.now() - new Date(todayRecord.clockInAt).getTime());
      todayRecord.workedMs = todayRecord.workedMs > 0 ? todayRecord.workedMs : liveMs;
      todayRecord.workedHours = Math.round((todayRecord.workedMs / 3600000) * 100) / 100;
    }
 
    res.json({ success: true, record: todayRecord });
 
    // res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/attendance/leaves
exports.getLeaveRequests = async (req, res) => {
  try {
    const { status, user, startDate, endDate, page = 1, limit = 100 } = req.query;
    const elevated = canViewAllAttendance(req.user);
    const query = {};

    if (status) query.status = status;
    if (!elevated) {
      query.user = req.user._id;
    } else if (user) {
      query.user = user;
    }

    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = getDayBounds(startDate).start;
      if (endDate) query.startDate.$lte = getDayBounds(endDate).end;
    }

    const leaves = await LeaveRequest.find(query)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await LeaveRequest.countDocuments(query);
    res.json({ success: true, total, leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/attendance/leaves
exports.applyLeave = async (req, res) => {
  try {
    const { leaveType = 'annual', startDate, endDate, reason = '', notifyViaEmail = true } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start date and end date are required' });
    }

    // Validate date format
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Please use YYYY-MM-DD format.' });
    }

    const start = getDayBounds(startDate).start;
    const end = getDayBounds(endDate).end;
    if (end < start) {
      return res.status(400).json({ success: false, message: 'End date cannot be before start date' });
    }

    const overlap = await LeaveRequest.findOne({
      user: req.user._id,
      status: { $in: ['pending', 'approved'] },
      startDate: { $lte: end },
      endDate: { $gte: start },
    });

    if (overlap) {
      return res.status(400).json({ success: false, message: 'Overlapping leave request already exists' });
    }

    // Normalize the leave type (legacy values such as 'Half-Day'/'Personal
    // Resion' are mapped to their canonical form) and pin half-day requests to
    // a single day so the half-day counter stays accurate (0.5 day).
    const normalizedLeaveType = normalizeLeaveType(leaveType);
    const halfDayLeave = normalizedLeaveType === 'half_day';
    let effectiveEnd = end;
    if (halfDayLeave && toDateKey(end) !== toDateKey(start)) {
      return res.status(400).json({
        success: false,
        message: 'A Half Day leave can only be requested for a single day. Set the end date equal to the start date.',
      });
    }
    if (halfDayLeave) effectiveEnd = getDayBounds(start).end;

    const policy = await getAttendancePolicy();
    const totalDays = halfDayLeave ? 0.5 : calculateLeaveDayCount(start, effectiveEnd, policy);
    const leave = await LeaveRequest.create({
      user: req.user._id,
      leaveType: normalizedLeaveType,
      startDate: start,
      endDate: effectiveEnd,
      totalDays,
      reason,
      status: 'pending',
    });

    // In-app notification for HR / Admin / Super Admin. Deliberately outside
    // the notifyViaEmail block below: the bell notification must fire even when
    // email is turned off or SMTP was never configured, otherwise a submitted
    // leave is completely invisible to the people who have to approve it.
    try {
      await notifyLeaveApprovers({
        requester: req.user,
        leave,
        typeLabel: leaveTypeLabel(normalizedLeaveType),
        periodLabel: `${formatApprovalDate(start)} to ${formatApprovalDate(effectiveEnd)}`,
        totalDays,
        reason: String(reason || '').trim(),
      });
    } catch (notifyErr) {
      console.error('Leave request notification failed:', notifyErr.message);
    }

    // Send email notification to HR and Admin if requested
    let emailSentTo = [];
    if (notifyViaEmail) {
      const hrAndAdminUsers = await User.find({
        role: { $in: ['hr', 'admin', 'super_admin'] },
        isActive: true,
      }).select('name email _id');

      const company = (await Settings.findOne().lean())?.branding?.appName || 'CRM Pro';
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      const startLabel = formatLongDate(start);
      const endLabel = formatLongDate(effectiveEnd);
      const typeLabel = leaveTypeLabel(normalizedLeaveType);
      const emailPromises = hrAndAdminUsers.map(async (hrUser) => {
        const result = await sendEmail({
          to: hrUser.email,
          // Hitting "Reply" in the mailbox reaches the requesting employee.
          replyTo: req.user.email,
          subject: `[${company}] Leave Request: ${req.user.name}`,
          text: `
============================================================
           LEAVE REQUEST NOTIFICATION
============================================================

From: ${req.user.name} (${req.user.role})
Company: ${company}

------------------------------------------------------------
                          DETAILS
------------------------------------------------------------

Leave Type:    ${typeLabel}
Start Date:    ${startLabel}
End Date:      ${endLabel}
Total Days:    ${totalDays} day(s)
Status:        PENDING APPROVAL

Reason:
${reason ? reason : 'Not specified'}

------------------------------------------------------------
                    NOTICE
------------------------------------------------------------

This is an automated notification from ${company}.
Please review this leave request and take appropriate action.

============================================================
          `,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .header h1 { margin: 0; font-size: 24px; }
                .content { background: #f9f9f9; padding: 25px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; }
                .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .info-table td { padding: 12px 15px; border-bottom: 1px solid #e0e0e0; }
                .info-table td:first-child { font-weight: bold; width: 150px; color: #555; background: #f0f0f0; }
                .info-table td:last-child { color: #333; }
                .status { display: inline-block; background: #fff3cd; color: #856404; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: bold; margin-top: 10px; }
                .footer { text-align: center; margin-top: 25px; padding-top: 15px; border-top: 1px solid #e0e0e0; color: #888; font-size: 12px; }
                .action-btn { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 15px; }
                .action-btn:hover { background: #4338ca; }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>📅 Leave Request</h1>
                <p>New Leave Request Submitted</p>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>A new leave request has been submitted and requires your approval.</p>
                
                <table class="info-table">
                  <tr>
                    <td>Employee Name</td>
                    <td><strong>${escapeHtml(req.user.name)}</strong></td>
                  </tr>
                  <tr>
                    <td>Employee Role</td>
                    <td>${escapeHtml(req.user.role)}</td>
                  </tr>
                  <tr>
                    <td>Leave Type</td>
                    <td><strong>${escapeHtml(typeLabel)}</strong></td>
                  </tr>
                  <tr>
                    <td>Start Date</td>
                    <td>${escapeHtml(startLabel)}</td>
                  </tr>
                  <tr>
                    <td>End Date</td>
                    <td>${escapeHtml(endLabel)}</td>
                  </tr>
                  <tr>
                    <td>Total Days</td>
                    <td><strong>${escapeHtml(totalDays)} day(s)</strong></td>
                  </tr>
                  <tr>
                    <td>Reason</td>
                    <td>${htmlTextBlock(reason)}</td>
                  </tr>
                </table>
                
                <div style="text-align: center;">
                  <span class="status">⏳ Pending Approval</span>
                </div>
                
                <p style="margin-top: 20px; text-align: center;">
                  Please review this leave request and take appropriate action.
                </p>

                <div style="text-align: center;">
                  <a class="action-btn" href="${escapeHtml(frontendUrl)}/attendance">Open Attendance &amp; Review</a>
                </div>
                <p style="margin-top: 10px; font-size: 12px; color: #888; text-align: center;">
                  Sign in as HR / Admin / Super Admin, then click the employee name under
                  &ldquo;Leave Requests&rdquo; to Approve or Reject this request.
                </p>
                <p style="margin-top: 4px; font-size: 12px; color: #888; text-align: center;">
                  You can also simply reply to this email to reach ${escapeHtml(req.user.name)}
                  (${escapeHtml(req.user.email)}) directly.
                </p>
              </div>
              <div class="footer">
                <p>This is an automated notification from <strong>${escapeHtml(company)}</strong></p>
                <p>Please do not reply to this email.</p>
              </div>
            </body>
            </html>
          `,
        });

        return {
          recipient: hrUser._id,
          email: hrUser.email,
          sentAt: new Date(),
          delivered: !!result.sent,
          // Kept so Admin/HR can see *why* a notification was not delivered
          // (e.g. SMTP not configured) instead of just a false flag.
          ...(result.sent ? {} : { failureReason: result.reason || 'unknown_error' }),
        };
      });

      emailSentTo = await Promise.all(emailPromises);

      // Confirm to the employee that their request was received. This is sent
      // regardless of whether the HR/Admin copies went out, so the requester
      // always has a record of what they submitted.
      const confirmResult = await sendLeaveRequestConfirmationEmail({
        requester: req.user,
        typeLabel,
        startLabel,
        endLabel,
        totalDays,
        reason,
      });

      emailSentTo.push({
        recipient: req.user._id,
        email: req.user.email,
        sentAt: new Date(),
        delivered: !!confirmResult?.sent,
        ...(confirmResult?.sent ? {} : { failureReason: confirmResult?.reason || 'unknown_error' }),
      });

      // Update the leave request with email notification records
      await LeaveRequest.findByIdAndUpdate(leave._id, {
        emailSentTo,
      });
    }

    const populated = await LeaveRequest.findById(leave._id)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role')
      .populate('emailSentTo.recipient', 'name email role');

    // Only report addresses that actually accepted the message. Reporting the
    // attempted recipients would tell the user "sent" while nothing was
    // delivered (most commonly because SMTP is not configured).
    const deliveredEmails = emailSentTo.filter((e) => e.delivered).map((e) => e.email);
    const failedEmails = emailSentTo
      .filter((e) => !e.delivered)
      .map((e) => ({ email: e.email, reason: e.failureReason || 'unknown_error' }));

    // "not_configured" / "disabled" mean no mail could leave the server at all,
    // which the UI surfaces as a configuration warning rather than a failure.
    const emailNotConfigured = failedEmails.length > 0 &&
      failedEmails.every((f) => f.reason === 'not_configured' || f.reason === 'disabled');

    res.status(201).json({
      success: true,
      leave: populated,
      emailSent: deliveredEmails.length > 0,
      emailsSentTo: deliveredEmails,
      failedEmails,
      emailNotConfigured,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/attendance/leaves/:id/cancel
// Cancel a pending leave request
exports.cancelLeaveRequest = async (req, res) => {
  try {
    const { reviewNote = '' } = req.body;
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    // Only the requester or admin/HR/super_admin can cancel
    const isRequester = String(leave.user) === String(req.user._id);
    const isAdmin = [...LEAVE_APPROVER_ROLES].includes(req.user.role);

    if (!isRequester && !isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'You are not authorized to cancel this leave request' 
      });
    }

    // Only pending requests can be cancelled
    if (leave.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only pending leave requests can be cancelled' 
      });
    }

    // Update status to cancelled
    leave.status = 'cancelled';
    leave.reviewNote = String(reviewNote || '').trim();
    leave.reviewedBy = req.user._id;
    leave.reviewedAt = new Date();
    await leave.save();

    // Whoever ends up with an unwanted pending queue needs to know. When HR/Admin
    // cancels, notify the employee (they are the one who loses the request);
    // when the employee cancels, notify the approvers so they stop reviewing it.
    const cancelledByRequester = isRequester;
    const actorLine = `${req.user.name} (${req.user.role})`;
    const periodLabel = `${formatApprovalDate(leave.startDate)} to ${formatApprovalDate(leave.endDate)}`;
    const typeLabelForCancel = leaveTypeLabel(leave.leaveType);
    const noteText = String(reviewNote || '').trim();

    try {
      if (cancelledByRequester) {
        const approvers = await User.find({
          role: { $in: LEAVE_APPROVER_ROLES },
          isActive: true,
          _id: { $ne: req.user._id },
        }).select('_id');

        await notifyMany(
          approvers.map((approver) => ({
            recipientId: approver._id,
            senderId: req.user._id,
            type: 'leave_cancelled',
            title: 'Leave request withdrawn',
            message:
              `${req.user.name} (${req.user.role}) cancelled their pending ${typeLabelForCancel} request for ${periodLabel}.` +
              (noteText ? ` Reason: ${noteText}` : ''),
            link: '/attendance/leaves',
          }))
        );
      } else {
        await notifyUser({
          recipientId: leave.user,
          senderId: req.user._id,
          type: 'leave_cancelled',
          title: 'Leave request cancelled',
          message:
            `Your ${typeLabelForCancel} request for ${periodLabel} was cancelled by ${actorLine}.` +
            (noteText ? ` Reason: ${noteText}` : ''),
          link: '/attendance/leaves',
        });
      }
    } catch (notifyErr) {
      console.error('Leave cancellation notification failed:', notifyErr.message);
    }

    const populated = await LeaveRequest.findById(leave._id)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role');

    res.json({ success: true, leave: populated, message: 'Leave request cancelled successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/attendance/leaves/:id/review
exports.reviewLeave = async (req, res) => {
  try {
    const { status, reviewNote = '' } = req.body;
    if (!['approved', 'rejected', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid review status' });
    }

    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }
    if (leave.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending requests can be reviewed' });
    }

    leave.status = status;
    leave.reviewNote = reviewNote;
    leave.reviewedBy = req.user._id;
    leave.reviewedAt = new Date();
    await leave.save();

    // Half-day leave types must land in the "Half Days" box; every other
    // approved leave feeds the "On Leave" box. Both stay flagged as on-leave so
    // the "Absent" box never double-counts the same day.
    const halfDayLeave = isHalfDayLeaveType(leave.leaveType) || Number(leave.totalDays) === 0.5;
    const leaveRecordStatus = halfDayLeave ? 'half_day' : 'leave';

    if (status === 'approved') {
      const leaveUser = await User.findById(leave.user).select('_id shiftCode role');
      
      // Run full reconciliation for historical dates
      await reconcileMissingAttendanceRecords({
        users: leaveUser ? [leaveUser] : [],
        startDate: leave.startDate,
        endDate: leave.endDate,
        actedBy: req.user._id,
      });
      
      // Also update any existing attendance records within the leave date range
      // that might have been created today or for future dates (which the
      // reconciliation function skips)
      const leaveStart = getDayBounds(leave.startDate).start;
      const leaveEnd = getDayBounds(leave.endDate).end;
      
      // Every record already present in the period (clocked-in days included) so
      // the sync loop below never overwrites a day the employee actually worked.
      const allRecords = await AttendanceRecord.find({
        user: leave.user,
        attendanceDate: { $gte: leaveStart, $lte: leaveEnd },
      }).select('_id attendanceDate clockInAt status');

      const recordedDayKeys = new Set(
        allRecords.map((r) => getDayBounds(r.attendanceDate).start.getTime())
      );

      // Auto-marked 'absent' records (and stale leave/half-day ones) with no
      // clock-in are converted so the day lands in the right dashboard box.
      const existingRecords = allRecords.filter(
        (r) => !r.clockInAt && ['absent', 'not_clocked_in', 'leave', 'half_day'].includes(r.status)
      );

      for (const record of existingRecords) {
        record.status = leaveRecordStatus;
        record.isOnLeave = true;
        record.isAbsent = false;
        record.isHalfDay = halfDayLeave;
        record.leaveRequest = leave._id;
        record.updatedBy = req.user._id;
        await record.save();
      }

      // Days inside the leave period that have no attendance record yet are
      // created now, because reconciliation skips today/future dates and honours
      // the auto-mark setting - an approved request must always materialise them
      // so the Half Days / On Leave counters pick the day up.
      const leaveDays = enumerateDays(leave.startDate, leave.endDate);
      const daysNeedingSync = leaveDays.filter(
        (day) => !recordedDayKeys.has(getDayBounds(day).start.getTime())
      );

      if (daysNeedingSync.length > 0) {
        const policy = await getAttendancePolicy();

        for (const day of daysNeedingSync) {
          // Weekly offs and holidays keep their own status instead of "leave".
          if (isWeeklyOff(day, policy) || getHolidayForDate(day, policy)) continue;

          const dayStart = getDayBounds(day).start;
          const shift = resolveUserShift(leaveUser, policy);
          try {
            await AttendanceRecord.create({
              user: leave.user,
              attendanceDate: dayStart,
              status: leaveRecordStatus,
              isLate: false,
              isHalfDay: halfDayLeave,
              lateMinutes: 0,
              isEarlyCheckout: false,
              earlyCheckoutMinutes: 0,
              shiftCode: shift.code,
              shiftName: shift.name,
              isAbsent: false,
              isOnLeave: true,
              leaveRequest: leave._id,
              isHoliday: false,
              holidayName: '',
              note: '',
              createdBy: req.user._id,
              updatedBy: req.user._id,
            });
          } catch (createErr) {
            // Unique index (user + attendanceDate) raced with another writer -
            // the records for that day already exist, so counters are correct.
            if (createErr.code !== 11000) throw createErr;
          }
        }
      }
    }

    // Let the requester know the outcome (in-app notification + email). For a
    // rejection the reviewer's reason is always forwarded to the employee so
    // they know exactly why the request was declined.
    const decisionLabel = {
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
    }[status] || status;
    const reviewerLine = `${req.user.name} (${req.user.role})`;
    const typeLabel = leaveTypeLabel(leave.leaveType);
    const periodLabel = `${new Date(leave.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} to ${new Date(leave.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const noteText = String(reviewNote || '').trim();

    try {
      // Map the decision to its own notification type so the employee sees the
      // correct wording. Collapsing 'cancelled' into 'leave_rejected' would
      // tell someone their request was rejected when HR merely withdrew it.
      const reviewNotificationType = {
        approved: 'leave_approved',
        rejected: 'leave_rejected',
        cancelled: 'leave_cancelled',
      }[status] || 'leave_rejected';

      await notifyUser({
        recipientId: leave.user,
        senderId: req.user._id,
        type: reviewNotificationType,
        title: `Leave request ${decisionLabel.toLowerCase()}`,
        message:
          `Your ${typeLabel} request for ${periodLabel} was ${decisionLabel.toLowerCase()} by ${reviewerLine}.` +
          (noteText ? ` Reason: ${noteText}` : ''),
        link: '/attendance/leaves',
      });
    } catch (notifyErr) {
      console.error('Leave review notification failed:', notifyErr.message);
    }

    await sendLeaveReviewEmail({
      leave,
      requesterId: leave.user,
      status,
      decisionLabel,
      reviewerLine,
      typeLabel,
      noteText,
    });


    const populated = await LeaveRequest.findById(leave._id)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role');

    res.json({ success: true, leave: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/attendance/leaves/estimate
// Live preview for the leave form. Uses the same policy rules as
// calculateLeaveDayCount() (weekly offs, monthly offs, holidays) so the number
// shown while the user fills the form is exactly the number the server stores.
exports.estimateLeaveDays = async (req, res) => {
  try {
    const { startDate, endDate, leaveType = 'annual' } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate are required' });
    }

    const start = getDayBounds(startDate).start;
    const end = getDayBounds(endDate).end;
    if (end < start) {
      return res.status(400).json({ success: false, message: 'End date cannot be before start date' });
    }

    // A half day always costs 0.5 - nothing to calculate.
    if (isHalfDayLeaveType(leaveType)) {
      return res.json({ success: true, calendarDays: 1, workingDays: 0.5, totalDays: 0.5, excludedDays: [] });
    }

    const policy = await getAttendancePolicy();
    const days = enumerateDays(start, end);
    const excludedDays = [];
    let workingDays = 0;

    for (const day of days) {
      const key = toDateKey(day);
      if (isWeeklyOff(day, policy)) {
        excludedDays.push({ date: key, label: 'Weekly off' });
        continue;
      }
      const monthlyOff = getMonthlyOffRuleForDate(day, policy);
      if (monthlyOff) {
        excludedDays.push({ date: key, label: monthlyOff.label || monthlyOff.name || 'Monthly off' });
        continue;
      }
      const holiday = getHolidayForDate(day, policy);
      if (holiday) {
        excludedDays.push({ date: key, label: holiday.name || 'Holiday' });
        continue;
      }
      workingDays += 1;
    }

    res.json({
      success: true,
      calendarDays: days.length,
      workingDays,
      // Mirrors the floor/ceiling applied by calculateLeaveDayCount().
      totalDays: Math.max(0.5, workingDays || 1),
      excludedDays,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/attendance/leaves/emails
// Get all leave request emails sent by users (for Admin/HR to view)
exports.getLeaveRequestEmails = async (req, res) => {
  try {
    const { page = 1, limit = 50, startDate, endDate, status } = req.query;
    
    // Only Admin, HR, and Super Admin can view emails
    if (!['super_admin', 'admin', 'hr'].includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only Admin, HR, and Super Admin can view leave request emails' 
      });
    }

    const query = {
      'emailSentTo.recipient': { $exists: true, $ne: [] },
    };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (status) {
      query.status = status;
    }

    const leaves = await LeaveRequest.find(query)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role')
      .populate('emailSentTo.recipient', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await LeaveRequest.countDocuments(query);

    // Format the response to show email details
    const emails = leaves.map(leave => ({
      leaveId: leave._id,
      employee: leave.user,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      totalDays: leave.totalDays,
      reason: leave.reason,
      status: leave.status,
      submittedAt: leave.createdAt,
      reviewedBy: leave.reviewedBy,
      reviewedAt: leave.reviewedAt,
      reviewNote: leave.reviewNote,
      emailsSent: leave.emailSentTo.map(email => ({
        recipient: email.recipient,
        email: email.email,
        sentAt: email.sentAt,
        delivered: email.delivered,
        failureReason: email.failureReason || '',
      })),
    }));

    res.json({ 
      success: true, 
      total,
      emails,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/attendance/reconcile
exports.reconcileAttendance = async (req, res) => {
  try {
    const { startDate, endDate, user } = req.body;
    const elevated = canViewAllAttendance(req.user);

    const from = startDate ? getDayBounds(startDate).start : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = endDate ? getDayBounds(endDate).end : new Date();

    const users = !elevated
      ? [req.user]
      : user
        ? await User.find({ _id: user, isActive: true }).select('_id shiftCode role')
        : await User.find({ isActive: true }).select('_id shiftCode role');

    const result = await reconcileMissingAttendanceRecords({
      users,
      startDate: from,
      endDate: to,
      actedBy: req.user._id,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/attendance/late-checkins
// Pending late check-ins the current user is allowed to review, based on the
// requester's role (HR/Manager late check-ins are only visible to Super Admin
// and Admin; regular staff's to Admin/HR/Manager as well).
exports.getLateCheckIns = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const approverRole = req.user.role;
    if (!['super_admin', 'admin', 'hr', 'manager'].includes(approverRole)) {
      return res.status(403).json({ success: false, message: 'You are not allowed to review late check-ins' });
    }

    const query = {
      lateApprovalStatus: 'pending',
      status: 'pending',
    };
    if (startDate || endDate) {
      query.attendanceDate = {};
      if (startDate) query.attendanceDate.$gte = getDayBounds(startDate).start;
      if (endDate) query.attendanceDate.$lte = getDayBounds(endDate).end;
    }

    // Pull the pending records, then filter by what this approver may review.
    const pending = await AttendanceRecord.find(query)
      .populate('user', 'name email avatar role department shiftCode')
      .populate('lateReviewedBy', 'name email role')
      .sort({ attendanceDate: -1 });

    const records = pending.filter((record) => {
      const requesterRole = record.user?.role || 'team_member';
      // Super Admin sees everything pending (including other Super Admins' if
      // somehow present). Everyone else is limited by the routing matrix.
      if (approverRole === 'super_admin') return true;
      return canApproveLateCheckIn(approverRole, requesterRole) && String(record.user?._id) !== String(req.user._id);
    });

    res.json({ success: true, records, total: records.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/attendance/late-checkins/:id/review
// Approve or reject a pending late check-in. The requester is notified with
// the reviewer's details (name + role) and optional review note.
exports.reviewLateCheckIn = async (req, res) => {
  try {
    const { decision, reviewNote = '' } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
    }

    const record = await AttendanceRecord.findById(req.params.id).populate('user', 'name email role');
    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }
    if (record.lateApprovalStatus !== 'pending' || record.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'This late check-in has already been reviewed' });
    }

    const requesterRole = record.user?.role || 'team_member';
    if (!canApproveLateCheckIn(req.user.role, requesterRole)) {
      return res.status(403).json({
        success: false,
        message: `A ${requesterRole}'s late check-in must be approved by ${getApproversForRequester(requesterRole).join(' or ')}`,
      });
    }

    // Prevent reviewing your own pending late check-in.
    if (String(record.user?._id) === String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You cannot review your own late check-in' });
    }

    record.lateApprovalStatus = decision;
    record.lateReviewedBy = req.user._id;
    record.lateReviewedAt = new Date();
    record.lateReviewNote = String(reviewNote || '').slice(0, 500);
    // Approved -> normal 'late' status; rejected -> treated as absent.
    record.status = decision === 'approved' ? 'late' : 'absent';
    record.isAbsent = decision === 'rejected';
    record.updatedBy = req.user._id;
    await record.save();

    // Notify the requester with the approver's details included.
    const reviewDateLabel = formatApprovalDate(new Date());
    await notifyUser({
      recipientId: record.user._id,
      senderId: req.user._id,
      type: decision === 'approved' ? 'late_checkin_approved' : 'late_checkin_rejected',
      title: decision === 'approved' ? 'Late check-in approved' : 'Late check-in rejected',
      message: `Your late check-in on ${formatApprovalDate(record.attendanceDate)} was ${decision} by ${req.user.name} (${req.user.role}).${record.lateReviewNote ? ` Note: ${record.lateReviewNote}` : ''} — reviewed on ${reviewDateLabel}`,
      link: '/attendance',
    });

    const populated = await AttendanceRecord.findById(record._id)
      .populate('user', 'name email avatar role department shiftCode')
      .populate('lateReviewedBy', 'name email role');

    res.json({ success: true, record: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};