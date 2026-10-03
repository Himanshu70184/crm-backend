const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: [
        'task_assigned',
        'task_updated',
        'task_completed',
        'comment_added',
        'mentioned',
        'project_updated',
        'deadline_reminder',
        'late_checkin_pending',
        'late_checkin_approved',
        'late_checkin_rejected',
        // Leave workflow. These MUST stay in sync with the types the leave
        // controller passes to notifyUser() - an unknown value fails Mongoose
        // enum validation, which is silently swallowed and results in the
        // recipient never seeing the notification.
        'leave_requested',
        'leave_approved',
        'leave_rejected',
        'leave_cancelled',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: '' },
    read: { type: Boolean, default: false },
    relatedTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    relatedProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
