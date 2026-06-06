const User = require('../models/User');
const { reconcileMissingAttendanceRecords } = require('../services/attendancePolicyService');

let attendanceInterval = null;

async function runAttendanceReconcile() {
  try {
    const users = await User.find({ isActive: true }).select('_id shiftCode role');
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const result = await reconcileMissingAttendanceRecords({
      users,
      startDate: lookbackStart,
      endDate: now,
      actedBy: null,
    });

    if ((result.created || 0) > 0 || (result.updated || 0) > 0) {
      console.log(`Attendance reconcile: created=${result.created} updated=${result.updated}`);
    }
  } catch (error) {
    console.error('Attendance reconcile failed:', error.message);
  }
}

function startAttendanceReconcileCron() {
  if (attendanceInterval) return;

  runAttendanceReconcile();
  attendanceInterval = setInterval(runAttendanceReconcile, 60 * 60 * 1000);
}

module.exports = { startAttendanceReconcileCron };
