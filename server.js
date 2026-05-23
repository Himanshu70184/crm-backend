require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./src/config/db');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const projectRoutes = require('./src/routes/projects');
const taskRoutes = require('./src/routes/tasks');
const commentRoutes = require('./src/routes/comments');
const timeLogRoutes = require('./src/routes/timeLogs');
const dashboardRoutes = require('./src/routes/dashboard');
const notificationRoutes = require('./src/routes/notifications');
const settingsRoutes = require('./src/routes/settings');
const reportsRoutes = require('./src/routes/reports');
const activitiesRoutes = require('./src/routes/activities');
const setupRoutes = require('./src/routes/setup');

const { verifyEmailConnection } = require('./src/services/emailService');
const { startDeadlineCron } = require('./src/jobs/deadlineReminders');

connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV === 'development') return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/timelogs', timeLogRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/setup', setupRoutes);

const { protect } = require('./src/middleware/auth');
const { getActiveTimer } = require('./src/controllers/timerController');
app.get('/api/timer/active', protect, getActiveTimer);

// Health check
app.get('/api/health', (req, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'][
    require('mongoose').connection.readyState
  ];
  res.json({
    status: 'OK',
    timestamp: new Date(),
    port: PORT,
    database: require('mongoose').connection.name || null,
    dbState,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
  });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
  const emailStatus = await verifyEmailConnection();
  console.log(emailStatus.ok ? `✓ ${emailStatus.message}` : `⚠ Email: ${emailStatus.message}`);
  startDeadlineCron();
});
