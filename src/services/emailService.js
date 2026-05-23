const nodemailer = require('nodemailer');
const Settings = require('../models/Settings');

let transporter = null;
let lastConfigKey = '';

const buildConfigKey = (cfg) =>
  `${cfg.host}|${cfg.port}|${cfg.user}|${cfg.secure}`;

const resolveSmtpConfig = async () => {
  const envHost = process.env.SMTP_HOST;
  if (envHost) {
    return {
      host: envHost,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
    };
  }

  const settings = await Settings.findOne().lean();
  const smtp = settings?.smtp;
  if (smtp?.host && smtp?.user) {
    return {
      host: smtp.host,
      port: smtp.port || 587,
      secure: !!smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      from: smtp.from || smtp.user,
    };
  }
  return null;
};

const getTransporter = async () => {
  const config = await resolveSmtpConfig();
  if (!config?.host || !config.auth?.user || !config.auth?.pass) return null;

  const key = buildConfigKey({ ...config, user: config.auth.user });
  if (transporter && key === lastConfigKey) return { transporter, from: config.from };

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });
  lastConfigKey = key;
  return { transporter, from: config.from };
};

exports.isEmailConfigured = async () => {
  const t = await getTransporter();
  return !!t;
};

exports.verifyEmailConnection = async () => {
  const result = await getTransporter();
  if (!result) {
    return { ok: false, message: 'SMTP not configured. Set SMTP_* in .env or Admin → Settings → Email.' };
  }
  try {
    await result.transporter.verify();
    return { ok: true, message: 'SMTP connection verified successfully' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

exports.sendEmail = async ({ to, subject, html, text }) => {
  if (!to) return { sent: false, reason: 'no_recipient' };

  const settings = await Settings.findOne().lean();
  if (settings?.notifications?.emailEnabled === false) {
    return { sent: false, reason: 'disabled' };
  }

  const mail = await getTransporter();
  if (!mail) return { sent: false, reason: 'not_configured' };

  const company = settings?.branding?.appName || settings?.companyName || 'CRM Pro';

  try {
    await mail.transporter.sendMail({
      from: mail.from || `"${company}" <noreply@crm.local>`,
      to,
      subject,
      text: text || subject,
      html: html || `<p>${text || subject}</p>`,
    });
    return { sent: true };
  } catch (err) {
    console.error('Email send failed:', err.message);
    return { sent: false, reason: err.message };
  }
};

exports.resetTransporter = () => {
  transporter = null;
  lastConfigKey = '';
};
