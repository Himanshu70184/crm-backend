// Decisive diag: replicate the EXACT clockIn resolution chain (middleware path)
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Settings = require('./src/models/Settings');
const AttendanceRecord = require('./src/models/AttendanceRecord');
const {
  getAttendancePolicy,
  resolveUserShift,
  getAttendanceDayForShift,
  computeLateInfo,
} = require('./src/services/attendancePolicyService');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/crm');
  console.log('=== Settings docs ===');
  const settingsDocs = await Settings.find({}).lean();
  for (const s of settingsDocs) {
    const a = s.attendance || {};
    console.log('settingsId:', String(s._id), 'defaultShiftCode:', a.defaultShiftCode);
    console.log('shifts:', JSON.stringify((a.shifts || []).map((x) => ({ code: x.code, name: x.name, start: x.startTime, end: x.endTime, grace: x.graceMinutes, overnight: x.isOvernight }))));
  }

  console.log('=== Sarah users (raw lean) ===');
  const raws = await User.find({ name: /sarah/i }).lean();
  for (const u of raws) {
    console.log('LEAN   :', String(u._id), u.name, '| role:', u.role, '| dept:', u.department, '| shiftCode:', JSON.stringify(u.shiftCode));
  }

  console.log('=== Sarah users (schema-filtered = what req.user sees) ===');
  const schemaUsers = await User.find({ name: /sarah/i });
  for (const u of schemaUsers) {
    const o = u.toObject();
    console.log('SCHEMA :', String(o._id), o.name, '| role:', o.role, '| shiftCode:', JSON.stringify(o.shiftCode), '| hasPath:', Boolean(User.schema.path('shiftCode')));
  }

  console.log('=== Replicate clockIn resolution NOW ===');
  const policy = await getAttendancePolicy();
  console.log('normalized policy defaultShiftCode:', policy.defaultShiftCode, '| shift codes:', policy.shifts.map((s) => s.code).join(','));
  for (const u of schemaUsers) {
    const shift = resolveUserShift(u, policy);
    const attendanceDate = getAttendanceDayForShift(shift, new Date());
    const simulated = computeLateInfo(new Date('2026-09-22T11:42:00'), attendanceDate, shift);
    console.log(`user ${u.name} shiftCode=${JSON.stringify(u.shiftCode)} -> resolved: ${shift.code} / ${shift.name} (grace ${shift.graceMinutes})`);
    console.log(`  simulate 11:42 clock-in -> isLate=${simulated.isLate}, lateMinutes=${simulated.lateMinutes}`);
  }

  console.log("=== Sarah's attendance records (latest 3) ===");
  for (const u of schemaUsers) {
    const recs = await AttendanceRecord.find({ user: u._id }).sort({ createdAt: -1 }).limit(3).lean();
    for (const r of recs) {
      console.log('rec:', String(r._id), '| date:', r.attendanceDate ? new Date(r.attendanceDate).toISOString().slice(0, 10) : r.attendanceDate, '| shift:', r.shiftCode, '/', r.shiftName, '| status:', r.status, '| isLate:', r.isLate, 'lateMin:', r.lateMinutes, '| approval:', r.lateApprovalStatus, '| reason:', JSON.stringify(r.lateReason || ''), '| clockInAt:', r.clockInAt, '| createdAt:', r.createdAt, '| updatedAt:', r.updatedAt);
    }
  }

  await mongoose.disconnect();
})().catch((e) => { console.error('DIAG ERROR:', e); process.exit(1); });
