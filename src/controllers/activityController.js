const ActivityLog = require('../models/ActivityLog');

exports.getActivities = async (req, res) => {
  try {
    const { limit = 50, entityType, entityId } = req.query;
    const filter = {};
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = entityId;

    const activities = await ActivityLog.find(filter)
      .populate('user', 'name email avatar role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10));

    res.json({ success: true, activities });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
