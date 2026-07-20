const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '', trim: true },
  completed: { type: Boolean, default: false },
  // Multi-assignee support (subtask-level)
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Backward compatibility (older records may still store a single assignee)
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      default: 'todo',
      trim: true,
    },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },

    // Multi-assignee support (task-level)
    assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Backward compatibility (older records may still store a single assignee)
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dueDate: { type: Date },
    estimatedHours: { type: Number, default: 0 },
    loggedHours: { type: Number, default: 0 },
    subtasks: [subtaskSchema],
    tags: [{ type: String }],
    attachments: [
      {
        filename: String,
        originalname: String,
        path: String,
        size: Number,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    order: { type: Number, default: 0 },
    milestone: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ assignees: 1 });
// keep old index for older data/query patterns
taskSchema.index({ assignee: 1 });


module.exports = mongoose.model('Task', taskSchema);
