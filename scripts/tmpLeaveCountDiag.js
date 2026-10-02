/* Temporary diagnostic: why don't the Half Days / On Leave counters move after
   a leave approval? Run with: node scripts/tmpLeaveCountDiag.js            */
require('dotenv').config();
const mongoose = require('mongoose');
require('../src/models/User');
const LeaveRequest = require('../src/models/LeaveRequest');
const AttendanceRecord = require('../src/models/AttendanceRecord');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('DB:', mongoose.connection.name);

  const leaves = await LeaveRequest.find({ status: 'approved' })
    .populate('user', 'name role')
    .sort({ startDate: -1 })
    .limit(15)
    .lean();

  console.log(`\nApproved leaves: ${leaves.length}`);
  for (const l of leaves) {
    const recs = await AttendanceRecord.find({
      user: l.user?._id,
      attendanceDate: { $gte: l.startDate, $lte: l.endDate },
    }).select('attendanceDate status isOnLeave isHalfDay isAbsent leaveRequest clockInAt').lean();
    console.log(
      `\n- ${l.user?.name} (${l.user?.role}) [${l.leaveType}] totalDays=${l.totalDays} ` +
      `${new Date(l.startDate).toISOString().slice(0, 10)} -> ${new Date(l.endDate).toISOString().slice(0, 10)}`
    );
    if (!recs.length) console.log('    !! no attendance records in this period');
    for (const r of recs) {
      console.log(
        `    ${new Date(r.attendanceDate).toISOString().slice(0, 10)} status=${r.status} ` +
        `onLeave=${r.isOnLeave} halfDay=${r.isHalfDay} absent=${r.isAbsent} ` +
        `leaveRequest=${r.leaveRequest ? 'set' : 'null'} clockIn=${r.clockInAt ? 'yes' : 'no'}`
      );
    }
  }

  console.log('\n--- Status histogram (all records) ---');
  const hist = await AttendanceRecord.aggregate([
    { $group: { _id: '$status', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  hist.forEach((h) => console.log(`  ${h._id}: ${h.n}`));

  console.log('\n--- Flag totals ---');
  const flags = await AttendanceRecord.aggregate([
    {
      $group: {
        _id: null,
        halfDay: { $sum: { $cond: [{ $eq: ['$isHalfDay', true] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$isOnLeave', true] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$isAbsent', true] }, 1, 0] } },
      },
    },
  ]);
  console.log(flags[0] || 'none');

  await mongoose.disconnect();
})().catch((err) => {
  console.error('DIAG FAILED:', err.message);
  process.exit(1);
});
