/* Deep diagnostic: raw records, exact dates, and both query styles per user. */
require('dotenv').config();
const mongoose = require('mongoose');
const Settings = require('./src/models/Settings');
const AttendanceRecord = require('./src/models/AttendanceRecord');
require('./src/models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 4000 });

  const now = new Date();
  console.log('SERVER NOW:', now.toString());
  console.log('TZ offset (min):', now.getTimezoneOffset());

  const settings = await Settings.findOne().lean();
  console.log('SHIFT:', JSON.stringify(settings?.attendance?.shifts?.[0], null, 0));

  // All records in the last 48h — raw ISO dates
  const since = new Date(now.getTime() - 48 * 3600 * 1000);
  const records = await AttendanceRecord.find({ attendanceDate: { $gte: since } })
    .populate('user', 'name email role')
    .sort({ attendanceDate: -1 });

  console.log('\nRECORDS LAST 48H:', records.length);
  for (const r of records) {
    const d = new Date(r.attendanceDate);
    // Replicate findTodayRecord's range query for this record's user
    const { start, end } = (() => { const s = new Date(); s.setHours(0,0,0,0); const e = new Date(); e.setHours(23,59,59,999); return { start: s, end: e }; })();
    const hitToday = d >= start && d <= end;
    const exactHit = await AttendanceRecord.findOne({ user: r.user?._id, attendanceDate: r.attendanceDate }).countDocuments();
    const rangeHit = await AttendanceRecord.findOne({ user: r.user?._id, attendanceDate: { $gte: start, $lte: end } }).countDocuments();
    console.log(`- ${r.user?.name} (${r.user?.role}) email=${r.user?.email}`);
    console.log(`    attendanceDate=${r.attendanceDate.toISOString()} (local: ${d.toString()}) status=${r.status} approval=${r.lateApprovalStatus ?? 'n/a'}`);
    console.log(`    within today-bounds: ${hitToday} | exact-match query hits: ${exactHit} | today-range query hits: ${rangeHit}`);
  }

  // Frontend-style filter simulation: new Date('2026-09-21') as the browser sends it
  const feStart = new Date(new Date('2026-09-21'));
  feStart.setHours(0,0,0,0);
  const feEnd = new Date(new Date('2026-09-21'));
  feEnd.setHours(23,59,59,999);
  const feHits = await AttendanceRecord.countDocuments({ attendanceDate: { $gte: feStart, $lte: feEnd } });
  console.log(`\nFrontend "Today" filter range: ${feStart.toISOString()} .. ${feEnd.toISOString()} -> hits: ${feHits}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
