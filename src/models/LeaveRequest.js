const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leaveType: {
      type: String,
      enum: ['annual', 'sick', 'casual', 'unpaid', 'other'],
      default: 'annual',
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, default: 1, min: 0.5 },
    reason: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '' },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ user: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ status: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
