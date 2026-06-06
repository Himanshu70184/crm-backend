const mongoose = require('mongoose');
const { ORGANIZATION_MODULES } = require('../utils/organizationModules');

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

const attendanceShiftSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, default: '09:30' },
    endTime: { type: String, required: true, default: '18:30' },
    graceMinutes: { type: Number, default: 0, min: 0 },
    halfDayMinutes: { type: Number, default: 240, min: 1 },
    isOvernight: { type: Boolean, default: false },
  },
  { _id: false }
);

const attendanceHolidaySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    optional: { type: Boolean, default: false },
  },
  { _id: false }
);

const attendancePolicySchema = new mongoose.Schema(
  {
    defaultShiftCode: { type: String, default: 'general' },
    weeklyOffDays: {
      type: [Number],
      default: [0],
      validate: {
        validator: (days) => days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'weeklyOffDays must contain values between 0 (Sunday) and 6 (Saturday)',
      },
    },
    shifts: {
      type: [attendanceShiftSchema],
      default: () => ([
        {
          code: 'general',
          name: 'General Shift',
          startTime: '09:30',
          endTime: '18:30',
          graceMinutes: 0,
          halfDayMinutes: 240,
          isOvernight: false,
        },
      ]),
    },
    holidays: { type: [attendanceHolidaySchema], default: [] },
    autoMarkEnabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const organizationModulesSchema = new mongoose.Schema(
  ORGANIZATION_MODULES.reduce((fields, moduleDef) => {
    fields[moduleDef.key] = { type: Boolean, default: true };
    return fields;
  }, {}),
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
    organizationModules: { type: organizationModulesSchema, default: () => ({}) },
    attendance: { type: attendancePolicySchema, default: () => ({}) },
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
