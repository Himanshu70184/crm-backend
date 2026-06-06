const Project = require('../models/Project');
const Task = require('../models/Task');
const TimeLog = require('../models/TimeLog');
const User = require('../models/User');

exports.getReports = async (req, res) => {
  try {
    const { from, to } = req.query;
    const isAdmin = ['super_admin', 'admin', 'manager'].includes(req.user.role);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);

    const taskMatch = dateFilter.$gte ? { updatedAt: dateFilter } : {};

    const [taskCompletion, productivity, projectProgress, timeByUser, revenue] = await Promise.all([
      Task.aggregate([
        { $match: taskMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      TimeLog.aggregate([
        ...(dateFilter.$gte ? [{ $match: { date: dateFilter } }] : []),
        { $group: { _id: '$user', totalHours: { $sum: '$hours' }, entries: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { name: '$user.name', email: '$user.email', totalHours: 1, entries: 1 } },
        { $sort: { totalHours: -1 } },
        { $limit: 20 },
      ]),
      Project.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, avgProgress: { $avg: '$progress' } } },
      ]),
      TimeLog.aggregate([
        ...(dateFilter.$gte ? [{ $match: { date: dateFilter } }] : []),
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            hours: { $sum: '$hours' },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ]),
      Project.aggregate([
        { $group: { _id: null, totalBudget: { $sum: '$budget' }, totalRevenue: { $sum: '$revenue' } } },
      ]),
    ]);

    const completedTasks = await Task.countDocuments({ status: 'completed', ...taskMatch });
    const totalTasks = await Task.countDocuments(taskMatch);

    res.json({
      success: true,
      reports: {
        taskCompletion,
        productivity,
        projectProgress,
        timeTracking: timeByUser,
        revenue: revenue[0] || { totalBudget: 0, totalRevenue: 0 },
        completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
        teamSize: await User.countDocuments({ isActive: true, role: { $in: ['team_member', 'member', 'team_lead', 'manager'] } }),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.exportTimeReport = async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    const match = {};
    if (from || to) {
      match.date = {};
      if (from) match.date.$gte = new Date(from);
      if (to) match.date.$lte = new Date(to);
    }
    if (userId) match.user = userId;
    if (!['super_admin', 'admin', 'manager'].includes(req.user.role)) match.user = req.user._id;

    const logs = await TimeLog.find(match)
      .populate('user', 'name email')
      .populate('task', 'title')
      .populate('project', 'name')
      .sort({ date: -1 });

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
