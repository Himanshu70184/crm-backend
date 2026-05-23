/**
 * Seed demo data: node src/scripts/seed.js
 * Requires MONGO_URI in .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
// Uses MONGODB_URI or MONGO_URI from .env
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Settings = require('../models/Settings');

const users = [
  { name: 'Admin User', email: 'admin@crm.com', password: 'Admin@123', role: 'admin', department: 'Management' },
  { name: 'Sarah Manager', email: 'manager@crm.com', password: 'Manager@123', role: 'manager', department: 'Delivery' },
  { name: 'Alex Developer', email: 'dev@crm.com', password: 'Dev@123', role: 'member', department: 'Engineering' },
  { name: 'Jordan Designer', email: 'designer@crm.com', password: 'Dev@123', role: 'member', department: 'Design' },
  { name: 'Acme Corp', email: 'client@crm.com', password: 'Client@123', role: 'client', department: 'Client' },
];

async function seed() {
  await connectDB();
  console.log('Seeding database...');

  await Promise.all([User.deleteMany({}), Project.deleteMany({}), Task.deleteMany({})]);

  const createdUsers = await User.create(users);
  const admin = createdUsers.find((u) => u.role === 'admin');
  const manager = createdUsers.find((u) => u.role === 'manager');
  const dev = createdUsers.find((u) => u.role === 'member' && u.email === 'dev@crm.com');
  const designer = createdUsers.find((u) => u.role === 'member' && u.email === 'designer@crm.com');

  const project = await Project.create({
    name: 'Enterprise Portal Redesign',
    description: 'Full redesign of client portal with modern stack and improved UX.',
    status: 'active',
    priority: 'high',
    startDate: new Date(),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    owner: manager._id,
    team: [dev._id, designer._id],
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
      subtasks: t.status === 'in_progress' ? [
        { title: 'Figma tokens', completed: true },
        { title: 'Storybook setup', completed: false },
      ] : [],
    });
  }

  await Settings.findOneAndUpdate({}, { companyName: 'CRM Pro — Service Studio' }, { upsert: true });

  console.log('\n✅ Seed complete — use these accounts at http://localhost:3000/login\n');
  console.log('┌──────────┬─────────────────────┬──────────────┬────────────────────────────────────┐');
  console.log('│ Role     │ Email               │ Password     │ What to check                      │');
  console.log('├──────────┼─────────────────────┼──────────────┼────────────────────────────────────┤');
  console.log('│ admin    │ admin@crm.com       │ Admin@123    │ Reports, Team, Clients, Settings   │');
  console.log('│ manager  │ manager@crm.com     │ Manager@123  │ Projects, Kanban, assign tasks     │');
  console.log('│ member   │ dev@crm.com         │ Dev@123      │ My tasks, time tracking            │');
  console.log('│ member   │ designer@crm.com    │ Dev@123      │ Second team member (same access)   │');
  console.log('│ client   │ client@crm.com      │ Client@123   │ Projects view-only (Acme project)  │');
  console.log('└──────────┴─────────────────────┴──────────────┴────────────────────────────────────┘\n');
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
