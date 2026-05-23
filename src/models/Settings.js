const mongoose = require('mongoose');

const brandingSchema = new mongoose.Schema(
  {
    appName: { type: String, default: 'CRM Pro' },
    tagline: { type: String, default: 'Project & task management for service teams' },
    logoUrl: { type: String, default: '' },
    faviconUrl: { type: String, default: '' },
    primaryColor: { type: String, default: '#4f46e5' },
    primaryHover: { type: String, default: '#4338ca' },
    accentColor: { type: String, default: '#8b5cf6' },
    sidebarBg: { type: String, default: '#0f172a' },
    authGradientFrom: { type: String, default: '#eef2ff' },
    authGradientTo: { type: String, default: '#e0e7ff' },
  },
  { _id: false }
);

const smtpSchema = new mongoose.Schema(
  {
    host: { type: String, default: '' },
    port: { type: Number, default: 587 },
    secure: { type: Boolean, default: false },
    user: { type: String, default: '' },
    pass: { type: String, default: '' },
    from: { type: String, default: '' },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: 'CRM Pro' },
    companyEmail: { type: String, default: '' },
    companyPhone: { type: String, default: '' },
    companyLogo: { type: String, default: '' },
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, default: 'USD' },
    workingHoursPerDay: { type: Number, default: 8 },
    branding: { type: brandingSchema, default: () => ({}) },
    notifications: {
      emailEnabled: { type: Boolean, default: true },
      deadlineReminders: { type: Boolean, default: true },
      taskAssigned: { type: Boolean, default: true },
      mentionAlerts: { type: Boolean, default: true },
    },
    smtp: { type: smtpSchema, default: () => ({}) },
    integrations: {
      slackWebhook: { type: String, default: '' },
      githubOrg: { type: String, default: '' },
    },
    kanbanColumns: {
      type: [
        {
          id: { type: String, required: true },
          label: { type: String, required: true },
          color: { type: String, default: 'slate' },
          order: { type: Number, default: 0 },
          wipLimit: { type: Number, default: null },
        },
      ],
      default: undefined,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', settingsSchema);
