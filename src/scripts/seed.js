/**
 * Seed demo data: node src/scripts/seed.js
 * Requires MONGO_URI in .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Settings = require('../models/Settings');
const Role = require('../models/Role');
const { ROLE_PERMISSION_PRESETS } = require('../utils/permissions');

const users = [
  { name: 'Super Admin', email: 'superadmin@crm.com', password: 'Super@123', role: 'super_admin', department: 'Management', shiftCode: 'general' },
  { name: 'Admin User', email: 'admin@crm.com', password: 'Admin@123', role: 'admin', department: 'Management', shiftCode: 'general' },
  { name: 'HR Manager', email: 'hr@crm.com', password: 'Hr@123', role: 'hr', department: 'Human Resources', shiftCode: 'general' },
  { name: 'Sarah Manager', email: 'manager@crm.com', password: 'Manager@123', role: 'manager', department: 'Delivery', shiftCode: 'general' },
  { name: 'TeamLead Alex', email: 'teamlead@crm.com', password: 'Lead@123', role: 'team_lead', department: 'Engineering', shiftCode: 'morning' },
  { name: 'Alex Developer', email: 'dev@crm.com', password: 'Dev@123', role: 'team_member', department: 'Engineering', shiftCode: 'morning' },
  { name: 'Jordan Designer', email: 'designer@crm.com', password: 'Dev@123', role: 'team_member', department: 'Design', shiftCode: 'evening' },
  { name: 'Acme Corp', email: 'client@crm.com', password: 'Client@123', role: 'client', department: 'Client', shiftCode: 'general' },
];

const systemRoles = [
  { name: 'super_admin', displayName: 'Super Admin', description: 'Unrestricted access to everything', color: '#dc2626', hierarchy: 1, isSystem: true },
  { name: 'admin', displayName: 'Admin', description: 'Full access, can manage roles and users', color: '#7c3aed', hierarchy: 2, isSystem: true },
  { name: 'hr', displayName: 'HR', description: 'Human resources module access', color: '#0891b2', hierarchy: 3, isSystem: true },
  { name: 'manager', displayName: 'Manager', description: 'Manage projects, tasks, and teams', color: '#2563eb', hierarchy: 4, isSystem: true },
  { name: 'team_lead', displayName: 'Team Lead', description: 'Lead assigned team members and tasks', color: '#059669', hierarchy: 5, isSystem: true },
  { name: 'team_member', displayName: 'Team Member', description: 'View and update assigned tasks', color: '#64748b', hierarchy: 6, isSystem: true },
];

async function seedRoles() {
  for (const roleDef of systemRoles) {
    const preset = ROLE_PERMISSION_PRESETS[roleDef.name];
    const permissions = preset ? preset() : {};
    await Role.findOneAndUpdate(
      { name: roleDef.name },
      { ...roleDef, permissions },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  console.log('OK Roles seeded');
}

async function seed() {
  await connectDB();
  console.log('Seeding database...');

  await Promise.all([User.deleteMany({}), Project.deleteMany({}), Task.deleteMany({})]);
  await seedRoles();

  const createdUsers = await User.create(users);
  const manager = createdUsers.find((u) => u.role === 'manager');
  const teamLead = createdUsers.find((u) => u.role === 'team_lead');
  const dev = createdUsers.find((u) => u.email === 'dev@crm.com');
  const designer = createdUsers.find((u) => u.email === 'designer@crm.com');

  const project = await Project.create({
    name: 'Enterprise Portal Redesign',
    description: 'Full redesign of client portal with modern stack and improved UX.',
    status: 'active',
    priority: 'high',
    startDate: new Date(),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    owner: manager._id,
    team: [teamLead._id, dev._id, designer._id],
    client: { name: 'Acme Corp', email: 'client@crm.com', company: 'Acme Inc.' },
    budget: 45000,
    revenue: 28000,
    progress: 35,
    milestones: [
      { title: 'Discovery & Wireframes', status: 'completed', dueDate: new Date() },
      { title: 'UI Design System', status: 'in_progress', dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
      { title: 'Development Sprint 1', status: 'pending', dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    ],
    tags: ['web', 'enterprise'],
  });

  const tasks = [
    { title: 'Audit existing portal UX', status: 'completed', priority: 'high', assignee: designer._id },
    { title: 'Design component library', status: 'in_progress', priority: 'high', assignee: designer._id },
    { title: 'API integration layer', status: 'in_progress', priority: 'medium', assignee: dev._id },
    { title: 'Auth module refactor', status: 'todo', priority: 'high', assignee: dev._id },
    { title: 'Client review session', status: 'in_review', priority: 'medium', assignee: manager._id },
    { title: 'Performance benchmarks', status: 'blocked', priority: 'low', assignee: dev._id, tags: ['performance'] },
  ];

  for (const t of tasks) {
    await Task.create({
      ...t,
      project: project._id,
      reporter: manager._id,
      dueDate: new Date(Date.now() + Math.random() * 20 * 24 * 60 * 60 * 1000),
      subtasks: t.status === 'in_progress'
        ? [
            { title: 'Figma tokens', completed: true },
            { title: 'Storybook setup', completed: false },
          ]
        : [],
    });
  }

  await Settings.findOneAndUpdate(
    {},
    {
      companyName: 'CRM Pro - Service Studio',
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
    { upsert: true }
  );

  console.log('Done. Seed users available at http://localhost:3000/login');
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
