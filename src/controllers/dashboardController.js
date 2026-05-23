const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const TimeLog = require('../models/TimeLog');

// @GET /api/dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'admin';

    // Project stats
    const projectQuery = isAdmin ? {} : { $or: [{ owner: userId }, { team: userId }] };
    const [totalProjects, activeProjects] = await Promise.all([
      Project.countDocuments(projectQuery),
      Project.countDocuments({ ...projectQuery, status: 'active' }),
    ]);

    // Task stats
    const taskQuery = isAdmin ? {} : { assignee: userId };
    const taskStats = await Task.aggregate([
      { $match: taskQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    // Team count (admin only)
    const totalUsers = isAdmin ? await User.countDocuments({ isActive: true }) : null;

    // Recent projects
    const recentProjects = await Project.find(projectQuery)
      .populate('owner', 'name avatar')
      .populate('team', 'name avatar')
      .sort({ updatedAt: -1 })
      .limit(5);

    // My tasks
    const myTasks = await Task.find({ assignee: userId, status: { $ne: 'completed' } })
      .populate('project', 'name')
      .sort({ dueDate: 1 })
      .limit(10);

    // Hours logged this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const hoursThisWeek = await TimeLog.aggregate([
      { $match: { user: userId, date: { $gte: weekStart } } },
      { $group: { _id: null, total: { $sum: '$hours' } } },
    ]);

    // Task completion trend (last 7 days)
    const trend = await Task.aggregate([
      {
        $match: {
          status: 'completed',
          updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          ...(isAdmin ? {} : { assignee: userId }),
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Project status distribution
    const projectStatusDist = await Project.aggregate([
      { $match: projectQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const revenueStats = isAdmin
      ? await Project.aggregate([
          { $group: { _id: null, budget: { $sum: '$budget' }, revenue: { $sum: '$revenue' } } },
        ])
      : null;

    const teamPerformance = isAdmin
      ? await TimeLog.aggregate([
          { $match: { date: { $gte: weekStart } } },
          { $group: { _id: '$user', hours: { $sum: '$hours' } } },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
          { $unwind: '$user' },
          { $project: { name: '$user.name', hours: 1 } },
          { $sort: { hours: -1 } },
          { $limit: 5 },
        ])
      : null;

    const overdueTasks = await Task.countDocuments({
      dueDate: { $lt: new Date() },
      status: { $nin: ['completed'] },
      ...(isAdmin ? {} : { assignee: userId }),
    });

    res.json({
      success: true,
      stats: {
        totalProjects,
        activeProjects,
        totalUsers,
        overdueTasks,
        hoursThisWeek: hoursThisWeek[0]?.total || 0,
        taskStats,
        recentProjects,
        myTasks,
        trend,
        projectStatusDist,
        revenue: revenueStats?.[0] || { budget: 0, revenue: 0 },
        teamPerformance: teamPerformance || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
