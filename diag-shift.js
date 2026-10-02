/* Diagnostic: dump normalized attendance policy + resolved shift for Sarah. Safe to delete. */
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.DB_URI || process.env.DATABASE_URL;

(async () => {
  await mongoose.connect(uri);
  const svc = require('./src/services/attendancePolicyService');
  const policy = await svc.getAttendancePolicy();
  console.log('=== NORMALIZED POLICY ===');
  console.log('defaultShiftCode:', policy.defaultShiftCode);
  console.log('shifts:', JSON.stringify(policy.shifts, null, 2));

  const User = require('./src/models/User');
  const sarah = await User.findOne({ $or: [{ email: /sarah/i }, { name: /sarah/i }] }).lean();
  if (!sarah) {
    console.log('SARAH NOT FOUND');
  } else {
    console.log('=== SARAH ===');
    console.log('name:', sarah.name, '| role:', sarah.role, '| shiftCode:', JSON.stringify(sarah.shiftCode), '| department:', sarah.department);
    const shift = svc.resolveUserShift(sarah, policy);
    console.log('=== RESOLVED SHIFT ===');
    console.log(JSON.stringify(shift, null, 2));
    try {
      const late = svc.computeLateInfo(shift, new Date());
      console.log('=== LATE INFO (now) ===');
      console.log(JSON.stringify(late, null, 2));
    } catch (e) {
      console.log('computeLateInfo error:', e.message);
    }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('DIAG ERR:', e.message); process.exit(1); });
