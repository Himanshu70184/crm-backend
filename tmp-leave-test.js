/* Temporary end-to-end check for the leave request -> approval -> counters flow.
   Run: node tmp-leave-test.js   (delete after use) */
const mongoose = require('mongoose');
require('dotenv').config();

const API = 'http://127.0.0.1:5000/api';

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.token) throw new Error(`login ${email} failed: ${JSON.stringify(json)}`);
  return json.token;
}

const dateKey = (d) => new Date(d).toISOString().slice(0, 10);
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crmnew');
  const User = require('./src/models/User');
  const LeaveRequest = require('./src/models/LeaveRequest');
  const AttendanceRecord = require('./src/models/AttendanceRecord');

  const devUser = await User.findOne({ email: 'dev@crm.com' }).select('_id name');
  if (!devUser) throw new Error('dev@crm.com not found');

  // Far-future window so real historical data is never touched.
  const dayA = new Date();
  dayA.setDate(dayA.getDate() + 20);
  const dayB = new Date();
  dayB.setDate(dayB.getDate() + 21);

  await LeaveRequest.deleteMany({ user: devUser._id, startDate: { $gte: new Date(dateKey(dayA)) } });
  await AttendanceRecord.deleteMany({
    user: devUser._id,
    attendanceDate: { $gte: new Date(dateKey(dayA)), $lte: new Date(`${dateKey(dayB)}T23:59:59.999Z`) },
  });

  const devToken = await login('dev@crm.com', 'Dev@123');
  const adminToken = await login('admin@crm.com', 'Admin@123');

  // 1) Half-day leave request
  const halfRes = await fetch(`${API}/attendance/leaves`, {
    method: 'POST',
    headers: auth(devToken),
    body: JSON.stringify({
      leaveType: 'half_day',
      startDate: dateKey(dayA),
      endDate: dateKey(dayA),
      reason: 'Test half day',
      notifyViaEmail: false,
    }),
  });
  const halfJson = await halfRes.json();
  console.log('1) half-day request  ->', halfRes.status, halfJson.leave?._id || halfJson.message, 'totalDays=', halfJson.leave?.totalDays);

  // 2) Admin approves it
  const approveRes = await fetch(`${API}/attendance/leaves/${halfJson.leave._id}/review`, {
    method: 'PUT',
    headers: auth(adminToken),
    body: JSON.stringify({ status: 'approved', reviewNote: 'ok' }),
  });
  const approveJson = await approveRes.json();
  console.log('2) approve half-day  ->', approveRes.status, approveJson.leave?.status || approveJson.message);

  const rec = await AttendanceRecord.findOne({ user: devUser._id, attendanceDate: new Date(dateKey(dayA)) });
  console.log('   record', dateKey(dayA), '-> status=', rec?.status, 'isHalfDay=', rec?.isHalfDay, 'isOnLeave=', rec?.isOnLeave);

  // 3) Summary counters (admin view filtered to that employee)
  const sumRes = await fetch(
    `${API}/attendance?user=${devUser._id}&startDate=${dateKey(dayA)}&endDate=${dateKey(dayA)}&autoMark=false&limit=50`,
    { headers: auth(adminToken) }
  );
  const sumJson = await sumRes.json();
  console.log('3) summary half-day  ->', JSON.stringify({
    halfDayCount: sumJson.summary?.halfDayCount,
    leaveCount: sumJson.summary?.leaveCount,
    absentCount: sumJson.summary?.absentCount,
  }));

  await cleanup(devUser, AttendanceRecord, LeaveRequest, dayA, dayB, [halfJson.leave?._id]);
  await mongoose.disconnect();
}

async function cleanup(devUser, AttendanceRecord, LeaveRequest, dayA, dayB, ids) {
  const dates = [new Date(dateKey(dayA)), new Date(`${dateKey(dayB)}T23:59:59.999Z`)];
  await LeaveRequest.deleteMany({ _id: { $in: ids.filter(Boolean) } });
  await AttendanceRecord.deleteMany({ user: devUser._id, attendanceDate: { $gte: dates[0], $lte: dates[1] } });
  console.log('cleanup done');
}

main().catch(async (err) => {
  console.error('TEST ERROR:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
