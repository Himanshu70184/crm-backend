const User = require('../models/User');

const DEMO_USERS = [
  { name: 'Admin User', email: 'admin@crm.com', password: 'Admin@123', role: 'admin', department: 'Management' },
  { name: 'Sarah Manager', email: 'manager@crm.com', password: 'Manager@123', role: 'manager', department: 'Delivery' },
  { name: 'Alex Developer', email: 'dev@crm.com', password: 'Dev@123', role: 'member', department: 'Engineering' },
  { name: 'Jordan Designer', email: 'designer@crm.com', password: 'Dev@123', role: 'member', department: 'Design' },
  { name: 'Acme Corp', email: 'client@crm.com', password: 'Client@123', role: 'client', department: 'Client' },
];

exports.getStatus = async (req, res) => {
  try {
    const admin = await User.findOne({ email: 'admin@crm.com' }).select('email role isActive');
    const userCount = await User.countDocuments();
    res.json({
      success: true,
      database: require('mongoose').connection.name,
      userCount,
      adminExists: !!admin,
      adminRole: admin?.role,
      hint: admin
        ? 'Use admin@crm.com / Admin@123'
        : 'Click "Create demo users" below or run: npm run ensure-users',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/setup/bootstrap — only when DB has no users (first-time setup) */
exports.bootstrapDemoUsers = async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Database already has ${userCount} user(s). Use npm run ensure-users in backend to reset passwords.`,
      });
    }

    const created = [];
    for (const demo of DEMO_USERS) {
      const user = await User.create(demo);
      created.push({ email: user.email, role: user.role });
    }

    res.status(201).json({
      success: true,
      message: 'Demo users created. Login with admin@crm.com / Admin@123',
      users: created,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
