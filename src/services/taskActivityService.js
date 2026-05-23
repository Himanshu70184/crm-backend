const ActivityLog = require('../models/ActivityLog');

exports.logTaskActivity = async (user, action, taskId, metadata = {}) => {
  try {
    await ActivityLog.create({
      user: user._id || user,
      action,
      entityType: 'task',
      entityId: taskId,
      metadata,
    });
  } catch (err) {
    console.error('Task activity log failed:', err.message);
  }
};

exports.getTaskActivities = async (taskId, limit = 100) => {
  return ActivityLog.find({ entityType: 'task', entityId: taskId })
    .populate('user', 'name email avatar role')
    .sort({ createdAt: -1 })
    .limit(limit);
};
