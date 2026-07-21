const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    attendanceDate: { type: Date, required: true },
    clockInAt: { type: Date, default: null },
    clockOutAt: { type: Date, default: null },
    workMinutes: { type: Number, default: 0 },
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
        clockInScreenshot: { type: String, default: '' },
    clockOutScreenshot: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

attendanceRecordSchema.index({ user: 1, attendanceDate: -1 }, { unique: true });
attendanceRecordSchema.index({ attendanceDate: -1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);