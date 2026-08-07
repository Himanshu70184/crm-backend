const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    attendanceDate: { type: Date, required: true },
    clockInAt: { type: Date, default: null },
    clockOutAt: { type: Date, default: null },
    workMinutes: { type: Number, default: 0 },
    // Idle-adjusted worked time reported by the desktop Activity Tracker app.
    // The desktop app auto-pauses while the user is idle, so its reported
    // duration is the real working time. `workedMs` is the source of truth
    // for working hours when present (falls back to wall-clock otherwise).
    workedMs: { type: Number, default: 0 },
    workedHours: { type: Number, default: 0 },
 
    status: {
      type: String,
      enum: ['present', 'late', 'half_day', 'remote', 'absent', 'leave', 'holiday'],
      default: 'present',
    },
    isLate: { type: Boolean, default: false },
    isHalfDay: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    isEarlyCheckout: { type: Boolean, default: false },
    earlyCheckoutMinutes: { type: Number, default: 0 },
    shiftCode: { type: String, default: '' },
    shiftName: { type: String, default: '' },
    isAbsent: { type: Boolean, default: false },
    isOnLeave: { type: Boolean, default: false },
    leaveRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
    isHoliday: { type: Boolean, default: false },
    holidayName: { type: String, default: '' },
    note: { type: String, default: '' },
    clockInScreenshot: {
      type: String,
      required: [function () { return !!this.clockInAt; }, 'clockInScreenshot is required when clocked in'],
      validate: {
        validator: function (v) {
          if (!this.clockInAt) return true; // no clock-in on this record — screenshot doesn't apply
          return typeof v === 'string' && v.trim().length > 0;
        },
        message: 'clockInScreenshot cannot be empty when clocked in',
      },
    },
    clockOutScreenshot: {
      type: String,
      required: [function () { return !!this.clockOutAt; }, 'clockOutScreenshot is required when clocked out'],
      validate: {
        validator: function (v) {
          if (!this.clockOutAt) return true; // no clock-out on this record — screenshot doesn't apply
          return typeof v === 'string' && v.trim().length > 0;
        },
        message: 'clockOutScreenshot cannot be empty when clocked out',
      },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

attendanceRecordSchema.index({ user: 1, attendanceDate: -1 }, { unique: true });
attendanceRecordSchema.index({ attendanceDate: -1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);