const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  startDate: { type: Date },
  endDate: { type: Date },
  dueDate: { type: Date }, // kept for backward-compat with existing data/UI
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
  budget: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 }, // percentage, e.g. 18 for 18%
});

milestoneSchema.virtual('taxAmount').get(function () {
  return ((this.budget || 0) * (this.taxRate || 0)) / 100;
});
milestoneSchema.virtual('total').get(function () {
  return (this.budget || 0) - this.get('taxAmount');
});
milestoneSchema.set('toJSON', { virtuals: true });
milestoneSchema.set('toObject', { virtuals: true });

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
      default: 'planning',
    },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    startDate: { type: Date },
    endDate: { type: Date },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    team: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    client: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      company: { type: String, default: '' },
    },
    milestones: [milestoneSchema],
    tags: [{ type: String }],
    progress: { type: Number, default: 0, min: 0, max: 100 },
    budget: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    kanbanConfig: {
      wipLimits: {
        todo: { type: Number, default: null },
        in_progress: { type: Number, default: 5 },
        in_review: { type: Number, default: 3 },
        completed: { type: Number, default: null },
        blocked: { type: Number, default: 2 },
      },
    },
    activities: [
      {
        type: { type: String, default: 'update' },
        message: String,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);