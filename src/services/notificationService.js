const Notification = require('../models/Notification');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { sendEmail } = require('./emailService');
const { emitUsersEvent } = require('../socket/chatSocket');

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const emailAllowed = async (type) => {
  const settings = await Settings.findOne().lean();
  if (!settings?.notifications?.emailEnabled) return false;
  const map = {
    task_assigned: 'taskAssigned',
    mentioned: 'mentionAlerts',
    deadline_reminder: 'deadlineReminders',
    comment_added: 'mentionAlerts',
    task_updated: 'taskAssigned',
    task_completed: 'taskAssigned',
    project_updated: 'taskAssigned',
  };
  const key = map[type];
  return key ? settings.notifications[key] !== false : true;
};

const buildEmailHtml = ({ title, message, link, company }) => `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
    <p style="margin:0 0 8px;font-size:12px;color:#64748b;text-transform:uppercase">${company}</p>
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:18px">${title}</h2>
    <p style="color:#475569;line-height:1.5">${message}</p>
    ${link ? `<p style="margin-top:20px"><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open in CRM</a></p>` : ''}
  </div>
</body>
</html>`;

/**
 * Create in-app notification and optionally send email.
 */
exports.notifyUser = async ({
  recipientId,
  senderId = null,
  type,
  title,
  message,
  link = '',
  relatedTask = null,
  relatedProject = null,
}) => {
  if (!recipientId) return null;

  const recipient = await User.findById(recipientId).select('email name isActive');
  if (!recipient?.isActive) return null;

  const notification = await Notification.create({
    recipient: recipientId,
    sender: senderId,
    type,
    title,
    message,
    link,
    relatedTask,
    relatedProject,
  });

  const unreadCount = await Notification.countDocuments({ recipient: recipientId, read: false });
  emitUsersEvent([recipientId], 'notification:created', {
    notificationId: String(notification._id),
    unreadCount,
  });

  if (recipientId.toString() === senderId?.toString()) return notification;

  const canEmail = await emailAllowed(type);
  if (canEmail && recipient.email) {
    const settings = await Settings.findOne().lean();
    const company = settings?.branding?.appName || settings?.companyName || 'CRM Pro';
    const fullLink = link ? `${frontendUrl()}${link}` : frontendUrl();

    await sendEmail({
      to: recipient.email,
      subject: `[${company}] ${title}`,
      text: `${message}\n\n${fullLink}`,
      html: buildEmailHtml({ title, message, link: fullLink, company }),
    });
  }

  return notification;
};

exports.notifyMany = async (items) => {
  await Promise.all(items.map((item) => exports.notifyUser(item)));
};
