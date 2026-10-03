require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const connectDB = require('./src/config/db');
const { initializeChatSocket } = require('./src/socket/chatSocket');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const projectRoutes = require('./src/routes/projects');
const taskRoutes = require('./src/routes/tasks');
const commentRoutes = require('./src/routes/comments');
const timeLogRoutes = require('./src/routes/timeLogs');
const attendanceRoutes = require('./src/routes/attendance');
const dashboardRoutes = require('./src/routes/dashboard');
const notificationRoutes = require('./src/routes/notifications');
const settingsRoutes = require('./src/routes/settings');
const reportsRoutes = require('./src/routes/reports');
const activitiesRoutes = require('./src/routes/activities');
const setupRoutes = require('./src/routes/setup');
const rolesRoutes = require('./src/routes/roles');
const chatRoutes = require('./src/routes/chat');

const { verifyEmailConnection } = require('./src/services/emailService');
const { startDeadlineCron } = require('./src/jobs/deadlineReminders');
const { startAttendanceReconcileCron } = require('./src/jobs/attendanceReconciliation');

// Note: connectDB() is awaited in startServer() below so the server never
// accepts requests (or runs startup queries) before MongoDB is connected.

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// API responses should always carry a body for frontend data fetches.
// Disabling ETag avoids browser revalidation returning 304 without JSON.
app.disable('etag');

// ─── CORS ────────────────────────────────────────────────────────────────────
// Allowed browser origins come ONLY from the CORS_ORIGIN env var (comma
// separated, trimmed, empty entries dropped, duplicates removed). There are
// no hardcoded origins and no NODE_ENV-based bypass — every environment
// (production, staging, local) must set CORS_ORIGIN itself. Requests without
// an Origin header (curl, Postman, same-origin navigations, server-to-server
// calls) are always allowed.
const corsOrigins = Array.from(
  new Set(
    (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  )
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    // Cache CORS preflight results for 24h in the browser so cross-origin
    // PUT/POST/multipart calls don't re-send an OPTIONS request every time.
    maxAge: 86400,
  })
);

initializeChatSocket(server, corsOrigins);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Static uploads — served WITHOUT authentication (the browser loads these
// via plain <img>/media requests that carry no Authorization header), so a
// public 1-day browser cache is safe and stops re-downloading avatars and
// chat attachments on every visit. send() emits `public, max-age=86400`.
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'), { maxAge: '1d' })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/timelogs', timeLogRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/chat', chatRoutes);

const { protect, enforceOrganizationModule } = require('./src/middleware/auth');
const { getActiveTimer } = require('./src/controllers/timerController');
app.get('/api/timer/active', protect, enforceOrganizationModule('timeTracking'), getActiveTimer);

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

// Start listening only after MongoDB is connected. Otherwise any query issued
// at startup (e.g. verifyEmailConnection -> Settings.findOne()) gets buffered
// by Mongoose and crashes with "buffering timed out after 10000ms".
const startServer = async () => {
  await connectDB();

  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
    try {
      const emailStatus = await verifyEmailConnection();
      console.log(emailStatus.ok ? `✓ ${emailStatus.message}` : `⚠ Email: ${emailStatus.message}`);
    } catch (err) {
      console.error(`⚠ Email check failed: ${err.message}`);
    }
    startDeadlineCron();
    startAttendanceReconcileCron();
  });
};

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
