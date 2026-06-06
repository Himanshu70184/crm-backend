const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const {
  getDayBounds,
  getAttendancePolicy,
  resolveUserShift,
  getAttendanceDayForShift,
  computeLateInfo,
  computeHalfDayInfo,
  computeEarlyCheckoutInfo,
  calculateLeaveDayCount,
  reconcileMissingAttendanceRecords,
} = require('../services/attendancePolicyService');

const ALLOWED_OVERVIEW_ROLES = ['super_admin', 'admin', 'hr'];

function canViewAllAttendance(user) {
  return ALLOWED_OVERVIEW_ROLES.includes(user?.role);
}

async function findTodayRecord(userId) {
  const { start, end } = getDayBounds();
  return AttendanceRecord.findOne({ user: userId, attendanceDate: { $gte: start, $lte: end } })
    .populate('user', 'name email avatar role department shiftCode')
    .populate('leaveRequest', 'leaveType status startDate endDate');
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
        halfDayCount: { $sum: { $cond: [{ $eq: ['$isHalfDay', true] }, 1, 0] } },
        absentCount: { $sum: { $cond: [{ $eq: ['$isAbsent', true] }, 1, 0] } },
        leaveCount: { $sum: { $cond: [{ $eq: ['$isOnLeave', true] }, 1, 0] } },
        holidayCount: { $sum: { $cond: [{ $eq: ['$isHoliday', true] }, 1, 0] } },
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
        .sort({ attendanceDate: -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      buildSummary(query, todayRecord),
    ]);

    res.json({ success: true, records, summary, total: records.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/attendance/clock-in
exports.clockIn = async (req, res) => {
  try {
    const { note = '' } = req.body;
    const policy = await getAttendancePolicy();
    const shift = resolveUserShift(req.user, policy);
    const attendanceDate = getAttendanceDayForShift(shift, new Date());
    const existing = await AttendanceRecord.findOne({ user: req.user._id, attendanceDate });

    if (existing?.clockInAt) {
      return res.status(400).json({ success: false, message: 'You have already clocked in today' });
    }

    const clockInAt = new Date();
    const record = existing || new AttendanceRecord({
      user: req.user._id,
      attendanceDate,
      createdBy: req.user._id,
    });

    const lateInfo = computeLateInfo(clockInAt, attendanceDate, shift);
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
    record.status = lateInfo.isLate ? 'late' : 'present';
    record.updatedBy = req.user._id;

    await record.save();

    const populated = await AttendanceRecord.findById(record._id)
      .populate('user', 'name email avatar role department shiftCode')
      .populate('leaveRequest', 'leaveType status startDate endDate')
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role');

    res.status(201).json({ success: true, record: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/attendance/clock-out
exports.clockOut = async (req, res) => {
  try {
    const { note = '' } = req.body;
    const policy = await getAttendancePolicy();
    const shift = resolveUserShift(req.user, policy);
    const attendanceDate = getAttendanceDayForShift(shift, new Date());
    const record = await AttendanceRecord.findOne({ user: req.user._id, attendanceDate });

    if (!record || !record.clockInAt) {
      return res.status(400).json({ success: false, message: 'Clock in first before clocking out' });
    }

    if (record.clockOutAt) {
      return res.status(400).json({ success: false, message: 'You have already clocked out today' });
    }

    const clockOutAt = new Date();
    const workMinutes = Math.max(0, Math.round((clockOutAt.getTime() - new Date(record.clockInAt).getTime()) / 60000));
    const halfDayInfo = computeHalfDayInfo(workMinutes, shift);
    const earlyCheckout = computeEarlyCheckoutInfo(clockOutAt, attendanceDate, shift);

    record.clockOutAt = clockOutAt;
    record.workMinutes = workMinutes;
    record.note = note || record.note;
    record.shiftCode = shift.code;
    record.shiftName = shift.name;
    record.isHalfDay = halfDayInfo.isHalfDay;
    record.isEarlyCheckout = earlyCheckout.isEarlyCheckout;
    record.earlyCheckoutMinutes = earlyCheckout.earlyCheckoutMinutes;
    record.status = record.isHalfDay
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

// @GET /api/attendance/today
exports.getTodayAttendance = async (req, res) => {
  try {
    const elevated = canViewAllAttendance(req.user);
    const userId = elevated && req.query.user ? req.query.user : req.user._id;
    const record = await findTodayRecord(userId);
    res.json({ success: true, record });
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
    const { leaveType = 'annual', startDate, endDate, reason = '' } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start date and end date are required' });
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

    const policy = await getAttendancePolicy();
    const totalDays = calculateLeaveDayCount(start, end, policy);
    const leave = await LeaveRequest.create({
      user: req.user._id,
      leaveType,
      startDate: start,
      endDate: end,
      totalDays,
      reason,
      status: 'pending',
    });

    const populated = await LeaveRequest.findById(leave._id)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role');

    res.status(201).json({ success: true, leave: populated });
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

    if (status === 'approved') {
      const leaveUser = await User.findById(leave.user).select('_id shiftCode role');
      await reconcileMissingAttendanceRecords({
        users: leaveUser ? [leaveUser] : [],
        startDate: leave.startDate,
        endDate: leave.endDate,
        actedBy: req.user._id,
      });
    }

    const populated = await LeaveRequest.findById(leave._id)
      .populate('user', 'name email role department')
      .populate('reviewedBy', 'name email role');

    res.json({ success: true, leave: populated });
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