const mongoose = require('mongoose');

// Tracks per-user, per-conversation read state so unread counts can be
// computed/handled server-side instead of relying on fragile localStorage
// timestamps on the client. One document per (conversation, user) pair.
const chatReadStateSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The timestamp the user last read (opened) the conversation.
    lastReadAt: { type: Date, default: Date.now },
    // Server-tracked number of unread messages for this user in this conversation.
    unreadCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// One read-state row per (conversation, user).
chatReadStateSchema.index({ conversation: 1, user: 1 }, { unique: true });
chatReadStateSchema.index({ user: 1 });

module.exports = mongoose.model('ChatReadState', chatReadStateSchema);
