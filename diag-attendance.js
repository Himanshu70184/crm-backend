/* eslint-disable */
// One-off diagnostic: why does the Manager's attendance page show nothing?
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

function getDayBounds(dateInput = new Date()) {
  const date = new Date(dateInput);
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setHours(23, 59, 59, 999);
  return { start, end };
}

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/crmnew';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({ role: { $in: ['manager', 'hr'] } })
    .project({ name: 1, email: 1, role: 1, shiftCode: 1, isActive: 1 }).toArray();
  console.log('=== HR/MANAGER USERS ===');
  users.forEach((u) => console.log(JSON.stringify(u)));

  const settings = await db.collection('settings').findOne({}, { projection: { attendance: 1 } });
  const att = settings?.attendance || {};
  console.log('=== POLICY SHIFTS ===');
  console.log('defaultShiftCode:', att.defaultShiftCode);
  (att.shifts || []).forEach((s) => console.log(JSON.stringify(s)));

  const { start, end } = getDayBounds();
  console.log('=== TODAY BOUNDS (server-local) ===');
  console.log('start:', start.toISOString(), ' end:', end.toISOString());

  for (const u of users) {
    const recs = await db.collection('attendancerecords')
      .find({ user: new mongoose.Types.ObjectId(u._id) })
      .sort({ attendanceDate: -1 }).limit(4)
      .project({ attendanceDate: 1, status: 1, lateApprovalStatus: 1, clockInAt: 1, isLate: 1, lateMinutes: 1, shiftCode: 1, createdAt: 1 })
      .toArray();
    console.log(`=== RECORDS for ${u.name} (${u.role}, shiftCode=${u.shiftCode}) ===`);
    if (!recs.length) console.log('  (none)');
    recs.forEach((r) => console.log(JSON.stringify({
      attendanceDate: r.attendanceDate ? new Date(r.attendanceDate).toISOString() : null,
      status: r.status, lateApprovalStatus: r.lateApprovalStatus,
      clockInAt: r.clockInAt ? new Date(r.clockInAt).toISOString() : null,
      isLate: r.isLate, lateMinutes: r.lateMinutes, shiftCode: r.shiftCode,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    })));
  }

  await mongoose.disconnect();
})().catch((e) => { console.error('DIAG ERROR:', e.message); process.exit(1); });
