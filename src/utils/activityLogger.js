const ActivityLog = require('../models/ActivityLog');

exports.logActivity = async (user, action, entityType, entityId = null, metadata = {}) => {
  try {
    await ActivityLog.create({
      user: user._id || user,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    console.error('Activity log failed:', err.message);
  }
};
