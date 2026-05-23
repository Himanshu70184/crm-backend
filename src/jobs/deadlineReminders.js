const cron = require('node-cron');
const Task = require('../models/Task');
const Settings = require('../models/Settings');
const { notifyUser } = require('../services/notificationService');

const runDeadlineReminders = async () => {
  const settings = await Settings.findOne().lean();
  if (!settings?.notifications?.deadlineReminders) return;

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await Task.find({
    dueDate: { $gte: now, $lte: in24h },
    status: { $nin: ['completed'] },
    assignee: { $exists: true, $ne: null },
  }).populate('project', 'name');

  for (const task of tasks) {
    await notifyUser({
      recipientId: task.assignee,
      type: 'deadline_reminder',
      title: 'Task due soon',
      message: `"${task.title}" on ${task.project?.name || 'project'} is due ${task.dueDate.toLocaleDateString()}`,
      link: `/tasks/${task._id}`,
      relatedTask: task._id,
      relatedProject: task.project?._id,
    });
  }

  if (tasks.length) console.log(`Deadline reminders sent: ${tasks.length}`);
};

exports.startDeadlineCron = () => {
  // Daily at 9:00 AM server time
  cron.schedule('0 9 * * *', runDeadlineReminders);
  console.log('Deadline reminder cron scheduled (daily 9:00 AM)');
};

exports.runDeadlineReminders = runDeadlineReminders;
