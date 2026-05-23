const Settings = require('../models/Settings');
const Task = require('../models/Task');
const { logActivity } = require('../utils/activityLogger');
const { verifyEmailConnection, resetTransporter } = require('../services/emailService');
const {
  getKanbanColumnsFromSettings,
  normalizeKanbanColumns,
  slugifyColumnId,
  getDefaultKanbanColumns,
} = require('../utils/kanbanColumns');

const getOrCreateSettings = async () => {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  return settings;
};

const publicBranding = (settings) => ({
  companyName: settings.companyName,
  companyLogo: settings.companyLogo,
  branding: settings.branding,
});

/** Public — no auth (login page branding) */
exports.getPublicBranding = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ success: true, ...publicBranding(settings) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const data = settings.toObject();
    if (data.smtp?.pass) data.smtp.pass = data.smtp.pass ? '••••••••' : '';
    res.json({ success: true, settings: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const existing = await getOrCreateSettings();
    const body = { ...req.body };

    if (body.smtp?.pass === '••••••••' || body.smtp?.pass === '') {
      delete body.smtp?.pass;
      if (body.smtp) body.smtp = { ...existing.smtp?.toObject?.() || existing.smtp, ...body.smtp };
      delete body.smtp.pass;
    }

    if (body.branding) {
      body.branding = { ...(existing.branding?.toObject?.() || existing.branding || {}), ...body.branding };
    }
    if (body.notifications) {
      body.notifications = { ...(existing.notifications?.toObject?.() || existing.notifications || {}), ...body.notifications };
    }

    const settings = await Settings.findByIdAndUpdate(existing._id, body, {
      new: true,
      runValidators: true,
    });

    resetTransporter();
    await logActivity(req.user, 'Updated company settings', 'system', settings._id);
    const data = settings.toObject();
    if (data.smtp?.pass) data.smtp.pass = '••••••••';
    res.json({ success: true, settings: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.testEmail = async (req, res) => {
  try {
    const { to } = req.body;
    const recipient = to || req.user.email;
    const verify = await verifyEmailConnection();
    if (!verify.ok) {
      return res.status(400).json({ success: false, message: verify.message });
    }

    const { sendEmail } = require('../services/emailService');
    const settings = await getOrCreateSettings();
    const company = settings.branding?.appName || settings.companyName;

    const result = await sendEmail({
      to: recipient,
      subject: `[${company}] Test email`,
      text: 'Your CRM email notifications are configured correctly.',
      html: `<p>Your <strong>${company}</strong> CRM email notifications are working.</p>`,
    });

    if (!result.sent) {
      return res.status(400).json({ success: false, message: result.reason || 'Failed to send' });
    }
    res.json({ success: true, message: `Test email sent to ${recipient}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEmailStatus = async (req, res) => {
  try {
    const status = await verifyEmailConnection();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/settings/kanban-columns — all authenticated users */
exports.getKanbanColumns = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const raw = settings.kanbanColumns?.length
      ? settings.kanbanColumns.map((c) => ({
          id: c.id,
          label: c.label,
          color: c.color,
          order: c.order,
          wipLimit: c.wipLimit,
        }))
      : null;
    const columns = getKanbanColumnsFromSettings({ kanbanColumns: raw });
    res.json({ success: true, columns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** PUT /api/settings/kanban-columns — admin & manager */
exports.updateKanbanColumns = async (req, res) => {
  try {
    let { columns } = req.body;
    if (!Array.isArray(columns) || columns.length < 1) {
      return res.status(400).json({ success: false, message: 'At least one Kanban phase is required' });
    }

    const ids = new Set();
    for (const col of columns) {
      const id = col.id || slugifyColumnId(col.label);
      if (ids.has(id)) {
        return res.status(400).json({ success: false, message: `Duplicate phase id: ${id}` });
      }
      ids.add(id);
      col.id = id;
    }

    const normalized = normalizeKanbanColumns(columns);
    const settings = await getOrCreateSettings();
    const oldColumns = getKanbanColumnsFromSettings(settings);
    const removedIds = oldColumns.map((c) => c.id).filter((id) => !normalized.some((n) => n.id === id));
    const fallbackId = normalized[0].id;

    if (removedIds.length) {
      await Task.updateMany({ status: { $in: removedIds } }, { $set: { status: fallbackId } });
    }

    settings.kanbanColumns = normalized;
    await settings.save();
    require('../services/kanbanService').clearColumnCache();

    await logActivity(req.user, 'Updated Kanban workflow phases', 'system', settings._id);
    res.json({ success: true, columns: normalized });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
