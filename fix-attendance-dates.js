/* eslint-disable */
// ONE-OFF repair: attendance records whose attendanceDate was mis-attributed by
// the old overnight-window logic (isOvernight shifts whose end time is later
// the same day, e.g. 15:30 -> 23:30, created a 32h window that absorbed
// next-morning clock-ins and dated them to the PREVIOUS day).
//
// For every record that has a clockInAt it:
//   1. recomputes the correct shift-aligned attendance day from clockInAt,
//   2. moves the record if the stored date differs (skipping collisions),
//   3. recomputes isLate/lateMinutes against the corrected day,
//   4. resolves a pending late-approval that is no longer late under the
//      corrected window (so Clock Out unlocks).
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const AttendanceRecord = require('./src/models/AttendanceRecord');
const User = require('./src/models/User');
const {
  getAttendancePolicy,
  resolveUserShift,
  getAttendanceDayForShift,
  computeLateInfo,
} = require('./src/services/attendancePolicyService');

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/crmnew';
  await mongoose.connect(uri);
  const policy = await getAttendancePolicy();

  const users = await User.find({}).select('shiftCode');
  const shiftByUser = new Map(users.map((u) => [String(u._id), resolveUserShift(u, policy)]));

  // Newest first: newer records vacate their (wrong) day before older records
  // are re-homed, so the collision check sees the updated state.
  const records = await AttendanceRecord.find({ clockInAt: { $ne: null } })
    .sort({ attendanceDate: -1 });

  let moved = 0;
  let cleared = 0;
  let skipped = 0;
  let lateAdjusted = 0;

  for (const record of records) {
    const shift = policy.shifts.find((s) => s.code === record.shiftCode)
      || shiftByUser.get(String(record.user))
      || resolveUserShift(null, policy);

    const storedDay = new Date(record.attendanceDate);
    const correctDay = getAttendanceDayForShift(shift, record.clockInAt);
    const changedDay = correctDay.getTime() !== storedDay.getTime();

    if (changedDay) {
      const collision = await AttendanceRecord.findOne({
        _id: { $ne: record._id },
        user: record.user,
        attendanceDate: correctDay,
      });
      if (collision) {
        console.log(`SKIP (day already has a record): user=${record.user} ${storedDay.toISOString()} -> ${correctDay.toISOString()}`);
        skipped += 1;
        continue;
      }
      record.attendanceDate = correctDay;
      moved += 1;
      console.log(`MOVED: user=${record.user} ${storedDay.toISOString()} -> ${correctDay.toISOString()}`);
    }

    const lateInfo = computeLateInfo(record.clockInAt, record.attendanceDate, shift);
    if (record.isLate !== lateInfo.isLate || Number(record.lateMinutes) !== lateInfo.lateMinutes) {
      record.isLate = lateInfo.isLate;
      record.lateMinutes = lateInfo.lateMinutes;
      lateAdjusted += 1;
    }

    // A pending approval that is no longer late under the corrected window is
    // moot — resolve it so the Clock Out button unlocks without a review.
    if (
      record.status === 'pending'
      && record.lateApprovalStatus === 'pending'
      && !lateInfo.isLate
    ) {
      record.status = 'present';
      record.lateApprovalStatus = null;
      cleared += 1;
      console.log(`CLEARED moot pending approval: user=${record.user} clockInAt=${new Date(record.clockInAt).toISOString()}`);
    }

    await record.save();
  }

  console.log(`DONE. moved=${moved} lateAdjusted=${lateAdjusted} clearedPending=${cleared} skipped=${skipped}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('MIGRATION ERROR:', err);
  process.exit(1);
});
