const mongoose = require('mongoose');

const timeLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    hours: { type: Number, required: true, min: 0.1, max: 24 },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, default: '' },
    billable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

timeLogSchema.index({ user: 1, date: -1 });
timeLogSchema.index({ project: 1 });
timeLogSchema.index({ task: 1 });

module.exports = mongoose.model('TimeLog', timeLogSchema);
