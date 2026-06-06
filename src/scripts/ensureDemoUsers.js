/**
 * Create or reset demo users and seed system roles (does NOT delete projects/tasks).
 * Run: npm run ensure-users
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const User = require('../models/User');
const Role = require('../models/Role');
const Settings = require('../models/Settings');
const { ROLE_PERMISSION_PRESETS } = require('../utils/permissions');

const DEMO_USERS = [
  { name: 'Super Admin',    email: 'superadmin@crm.com', password: 'Super@123',   role: 'super_admin', department: 'Management',      shiftCode: 'general' },
  { name: 'Admin User',     email: 'admin@crm.com',      password: 'Admin@123',   role: 'admin',       department: 'Management',      shiftCode: 'general' },
  { name: 'HR Manager',     email: 'hr@crm.com',         password: 'Hr@123',      role: 'hr',          department: 'Human Resources', shiftCode: 'general' },
  { name: 'Sarah Manager',  email: 'manager@crm.com',    password: 'Manager@123', role: 'manager',     department: 'Delivery',        shiftCode: 'general' },
  { name: 'TeamLead Alex',  email: 'teamlead@crm.com',   password: 'Lead@123',    role: 'team_lead',   department: 'Engineering',     shiftCode: 'morning' },
  { name: 'Alex Developer', email: 'dev@crm.com',        password: 'Dev@123',     role: 'team_member', department: 'Engineering',     shiftCode: 'morning' },
  { name: 'Jordan Designer',email: 'designer@crm.com',   password: 'Dev@123',     role: 'team_member', department: 'Design',          shiftCode: 'evening' },
  { name: 'Acme Corp',      email: 'client@crm.com',     password: 'Client@123',  role: 'client',      department: 'Client',          shiftCode: 'general' },
];

const SYSTEM_ROLES = [
  { name: 'super_admin', displayName: 'Super Admin', description: 'Unrestricted access to everything',     color: '#dc2626', hierarchy: 1, isSystem: true },
  { name: 'admin',       displayName: 'Admin',       description: 'Full access, manages roles and users', color: '#7c3aed', hierarchy: 2, isSystem: true },
  { name: 'hr',          displayName: 'HR',          description: 'Human resources module access',        color: '#0891b2', hierarchy: 3, isSystem: true },
  { name: 'manager',     displayName: 'Manager',     description: 'Manage projects, tasks, and teams',    color: '#2563eb', hierarchy: 4, isSystem: true },
  { name: 'team_lead',   displayName: 'Team Lead',   description: 'Lead assigned team and tasks',         color: '#059669', hierarchy: 5, isSystem: true },
  { name: 'team_member', displayName: 'Team Member', description: 'View and update assigned tasks',       color: '#64748b', hierarchy: 6, isSystem: true },
];

async function run() {
  await connectDB();
  console.log('Ensuring system roles and demo users...\n');

  for (const roleDef of SYSTEM_ROLES) {
    const preset = ROLE_PERMISSION_PRESETS[roleDef.name];
    const permissions = preset ? preset() : {};
    await Role.findOneAndUpdate(
      { name: roleDef.name },
      { ...roleDef, permissions },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log('  OK Role: ' + roleDef.displayName);
  }

  console.log('');

  for (const demo of DEMO_USERS) {
    let user = await User.findOne({ email: demo.email }).select('+password');
    if (user) {
      user.name = demo.name;
      user.role = demo.role;
      user.department = demo.department;
      user.shiftCode = demo.shiftCode || '';
      user.password = demo.password;
      user.isActive = true;
      await user.save();
      console.log('  OK Updated: ' + demo.email + ' (' + demo.role + ')');
    } else {
      await User.create(demo);
      console.log('  OK Created: ' + demo.email + ' (' + demo.role + ')');
    }
  }

  const settings = await Settings.findOneAndUpdate(
    {},
    {
      attendance: {
        defaultShiftCode: 'general',
        weeklyOffDays: [0],
        shifts: [
          { code: 'general', name: 'General Shift', startTime: '09:30', endTime: '18:30', graceMinutes: 0, halfDayMinutes: 240, isOvernight: false },
          { code: 'morning', name: 'Morning Shift', startTime: '07:00', endTime: '16:00', graceMinutes: 10, halfDayMinutes: 240, isOvernight: false },
          { code: 'evening', name: 'Evening Shift', startTime: '13:00', endTime: '22:00', graceMinutes: 10, halfDayMinutes: 240, isOvernight: false },
          { code: 'night', name: 'Night Shift', startTime: '22:00', endTime: '06:00', graceMinutes: 10, halfDayMinutes: 240, isOvernight: true },
        ],
        holidays: [],
        autoMarkEnabled: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log('  OK Attendance policy updated (' + (settings?.attendance?.shifts?.length || 0) + ' shifts)');

  console.log('\nDone! Login at http://localhost:3000/login');
  console.log('  Super Admin:  superadmin@crm.com / Super@123');
  console.log('  Admin:        admin@crm.com      / Admin@123\n');
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
