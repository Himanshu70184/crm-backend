const TimeLog = require('../models/TimeLog');
const Task = require('../models/Task');
const { logTaskActivity } = require('../services/taskActivityService');

// @GET /api/timelogs
exports.getTimeLogs = async (req, res) => {
  try {
    const { user, project, task, startDate, endDate, page = 1, limit = 50 } = req.query;
    const query = {};

    if (req.user.role === 'member') query.user = req.user._id;
    else if (user) query.user = user;

    if (project) query.project = project;
    if (task) query.task = task;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const total = await TimeLog.countDocuments(query);
    const logs = await TimeLog.find(query)
      .populate('user', 'name email avatar')
      .populate('task', 'title')
      .populate('project', 'name')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ date: -1 });

    const totalHours = logs.reduce((sum, l) => sum + l.hours, 0);

    res.json({ success: true, total, totalHours, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/timelogs
exports.createTimeLog = async (req, res) => {
  try {
    const log = await TimeLog.create({ ...req.body, user: req.user._id });

    // Update task logged hours
    const allLogs = await TimeLog.aggregate([
      { $match: { task: log.task } },
      { $group: { _id: null, total: { $sum: '$hours' } } },
    ]);
    await Task.findByIdAndUpdate(log.task, { loggedHours: allLogs[0]?.total || 0 });

    await log.populate([
      { path: 'user', select: 'name email avatar' },
      { path: 'task', select: 'title' },
      { path: 'project', select: 'name' },
    ]);

    await logTaskActivity(req.user, 'Logged time manually', log.task, {
      hours: log.hours,
      description: log.description,
    });

    res.status(201).json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/timelogs/:id
exports.updateTimeLog = async (req, res) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role !== 'admin') query.user = req.user._id;

    const log = await TimeLog.findOneAndUpdate(query, req.body, { new: true })
      .populate('user', 'name email avatar')
      .populate('task', 'title')
      .populate('project', 'name');

    if (!log) return res.status(404).json({ success: false, message: 'Log not found' });
    res.json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/timelogs/:id
exports.deleteTimeLog = async (req, res) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role !== 'admin') query.user = req.user._id;

    const log = await TimeLog.findOneAndDelete(query);
    if (!log) return res.status(404).json({ success: false, message: 'Log not found' });
    res.json({ success: true, message: 'Time log deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/timelogs/summary
exports.getTimelogSummary = async (req, res) => {
  try {
    const { project, startDate, endDate } = req.query;
    const match = {};
    if (project) match.project = require('mongoose').Types.ObjectId.createFromHexString(project);
    if (req.user.role === 'member') match.user = req.user._id;
    if (startDate || endDate) {
      match.date = {};
      if (startDate) match.date.$gte = new Date(startDate);
      if (endDate) match.date.$lte = new Date(endDate);
    }

    const summary = await TimeLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$user',
          totalHours: { $sum: '$hours' },
          entries: { $sum: 1 },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { 'user.name': 1, 'user.email': 1, 'user.avatar': 1, totalHours: 1, entries: 1 } },
    ]);

    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
