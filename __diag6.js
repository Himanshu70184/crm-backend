/* Diagnostic: simulate the Attendance Log API queries for each filter. */
require('dotenv').config();
const mongoose = require('mongoose');
const AttendanceRecord = require('./src/models/AttendanceRecord');
require('./src/models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 4000 });

  const User = mongoose.model('User');
  const sarah = await User.findOne({ email: 'manager@crm.com' }).select('_id name role');
  console.log('USER:', sarah?.name, '| id:', String(sarah?._id));

  const now = new Date();
  const mkBounds = (d) => { const s = new Date(d); s.setHours(0, 0, 0, 0); const e = new Date(d); e.setHours(23, 59, 59, 999); return { s, e }; };

  // Frontend "Today" preset: ISO date string from browser
  const iso = now.toISOString().split('T')[0];
  console.log('browser sends: startDate=' + iso + '&endDate=' + iso);

  // Backend getAttendanceRecords range computation
  const rangeStart = new Date(new Date(iso)); rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(new Date(iso)); rangeEnd.setHours(23, 59, 59, 999);
  console.log('server range (Today):', rangeStart.toISOString(), '..', rangeEnd.toISOString());

  const q = { user: sarah._id, attendanceDate: { $gte: rangeStart, $lte: rangeEnd } };
  const todayRecords = await AttendanceRecord.find(q).populate('user', 'name role');
  console.log('=> TODAY filter records:', todayRecords.length);
  todayRecords.forEach((r) => console.log('   -', r.status, r.attendanceDate.toISOString()));

  // This-month preset
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1); mStart.setHours(0, 0, 0, 0);
  const mEnd = mkBounds(now).e;
  const monthRecords = await AttendanceRecord.find({ user: sarah._id, attendanceDate: { $gte: mStart, $lte: mEnd } });
  console.log('\n=> THIS MONTH filter records:', monthRecords.length);
  monthRecords.forEach((r) => console.log('   -', r.attendanceDate.toISOString(), r.status, r.lateApprovalStatus ?? ''));

  // All her records ever
  const all = await AttendanceRecord.countDocuments({ user: sarah._id });
  console.log('\nSarah total records in DB:', all);

  // Global: any records today for anyone
  const anyoneToday = await AttendanceRecord.countDocuments({ attendanceDate: { $gte: rangeStart, $lte: rangeEnd } });
  console.log('records dated TODAY (all users):', anyoneToday);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
