const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leaveType: {
      type: String,
      // Canonical values are snake_case; the legacy spellings are kept so
      // existing rows keep validating. New writes always use the canonical set.
      enum: [
        'annual',
        'sick',
        'casual',
        'half_day',
        'personal',
        'unpaid',
        'other',
        // legacy values
        'Half-Day',
        'Personal Resion',
      ],
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
    // Email notification tracking
    emailSentTo: {
      type: [{
        recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        email: { type: String },
        sentAt: { type: Date, default: Date.now },
        delivered: { type: Boolean, default: true },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ user: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ status: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
