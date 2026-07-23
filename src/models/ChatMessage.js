const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: '',
      // A message must have text OR at least one attachment — not both required.
      required: function () {
        return !(this.attachments && this.attachments.length > 0);
      },
    },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    attachments: [
      {
        filename: { type: String },
        originalname: { type: String },
        path: { type: String },
        size: { type: Number },
      },
    ],
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);