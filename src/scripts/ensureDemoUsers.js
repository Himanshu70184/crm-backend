/**
 * Create or reset demo users (does NOT delete projects/tasks).
 * Run: npm run ensure-users
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const DEMO_USERS = [
  { name: 'Admin User', email: 'admin@crm.com', password: 'Admin@123', role: 'admin', department: 'Management' },
  { name: 'Sarah Manager', email: 'manager@crm.com', password: 'Manager@123', role: 'manager', department: 'Delivery' },
  { name: 'Alex Developer', email: 'dev@crm.com', password: 'Dev@123', role: 'member', department: 'Engineering' },
  { name: 'Jordan Designer', email: 'designer@crm.com', password: 'Dev@123', role: 'member', department: 'Design' },
  { name: 'Acme Corp', email: 'client@crm.com', password: 'Client@123', role: 'client', department: 'Client' },
];

async function run() {
  await connectDB();
  console.log('Ensuring demo users...\n');

  for (const demo of DEMO_USERS) {
    let user = await User.findOne({ email: demo.email }).select('+password');
    if (user) {
      user.name = demo.name;
      user.role = demo.role;
      user.department = demo.department;
      user.password = demo.password;
      user.isActive = true;
      await user.save();
      console.log(`  ✓ Updated: ${demo.email} (${demo.role})`);
    } else {
      await User.create(demo);
      console.log(`  ✓ Created: ${demo.email} (${demo.role})`);
    }
  }

  console.log('\nLogin at http://localhost:3000/login');
  console.log('  Admin:   admin@crm.com / Admin@123\n');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
