const mongoose = require('mongoose');

const chatConversationSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    type: { type: String, enum: ['direct', 'group', 'self'], default: 'direct' },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    // Group-level admins. Only meaningful when type === 'group'.
    // The creator is added here automatically when a group is created.
    // Admins can add/remove members and promote/revoke other admins.
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    avatar: { type: String, default: '' },
    isArchived: { type: Boolean, default: false },
    lastMessageAt: { type: Date, default: Date.now },
    // The currently pinned message for this conversation (group-wide/everyone scope).
    // For direct chats each user maintains their own pin on the frontend.
    pinnedMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  },
  { timestamps: true }
);

chatConversationSchema.index({ participants: 1, updatedAt: -1 });
chatConversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('ChatConversation', chatConversationSchema);