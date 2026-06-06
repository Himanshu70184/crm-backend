const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const Project = require('../models/Project');
const { notifyMany } = require('../services/notificationService');

function hasConversationAccess(req, conversation) {
  if (['super_admin', 'admin'].includes(req.user.role)) return true;
  return conversation.participants.some((p) => String(p) === String(req.user._id));
}

async function disposeConversation(conversationId) {
  await ChatMessage.deleteMany({ conversation: conversationId });
  await ChatConversation.deleteOne({ _id: conversationId });
}

async function disposeConversationIfEmpty(conversation) {
  if (!conversation) return false;
  if ((conversation.participants || []).length > 0) return false;
  await disposeConversation(conversation._id);
  return true;
}

async function cleanupZeroMemberConversations() {
  const empties = await ChatConversation.find({ participants: { $size: 0 } }).select('_id');
  if (!empties.length) return 0;
  const ids = empties.map((item) => item._id);
  await ChatMessage.deleteMany({ conversation: { $in: ids } });
  await ChatConversation.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

async function resolveTeamUserIds(req) {
  // Team scope = users in same department + users in projects where requester is owner/team member
  const projectUserIds = await Project.aggregate([
    {
      $match: {
        $or: [{ owner: req.user._id }, { team: req.user._id }],
      },
    },
    {
      $project: {
        users: {
          $setUnion: [
            ['$team'],
            ['$owner'],
          ],
        },
      },
    },
    { $unwind: '$users' },
    { $group: { _id: null, ids: { $addToSet: '$users' } } },
  ]);

  const departmentUsers = await User.find({ department: req.user.department, isActive: true }).select('_id');
  const depIds = departmentUsers.map((u) => u._id);
  const teamIds = projectUserIds[0]?.ids || [];

  const union = new Set([String(req.user._id), ...depIds.map(String), ...teamIds.map(String)]);
  return Array.from(union);
}

// GET /api/chat/conversations
exports.getConversations = async (req, res) => {
  try {
    await cleanupZeroMemberConversations();

    const { search = '' } = req.query;
    const query = { isArchived: false };

    // Users only see conversations they are in. Admin and super admin can see all.
    if (!['super_admin', 'admin'].includes(req.user.role)) {
      query.participants = req.user._id;
    }

    const conversations = await ChatConversation.find(query)
      .populate('participants', 'name email role avatar department')
      .populate('createdBy', 'name email role')
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(200);

    // Dispose conversations that have no resolvable participants (e.g. dangling user refs).
    const disposedIds = conversations
      .filter((c) => !Array.isArray(c.participants) || c.participants.length === 0)
      .map((c) => c._id);

    if (disposedIds.length) {
      await ChatMessage.deleteMany({ conversation: { $in: disposedIds } });
      await ChatConversation.deleteMany({ _id: { $in: disposedIds } });
    }

    const validConversations = conversations.filter(
      (c) => Array.isArray(c.participants) && c.participants.length > 0
    );

    const filtered = search.trim()
      ? validConversations.filter((c) => {
          const title = (c.title || '').toLowerCase();
          const participantNames = c.participants.map((p) => p.name.toLowerCase()).join(' ');
          return title.includes(search.toLowerCase()) || participantNames.includes(search.toLowerCase());
        })
      : validConversations;

    res.json({ success: true, conversations: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/conversations
exports.createConversation = async (req, res) => {
  try {
    const { title = '', participantIds = [], type = 'group', projectId = null } = req.body;

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ success: false, message: 'participantIds must be a non-empty array' });
    }

    const participantSet = new Set(participantIds.map(String));
    participantSet.add(String(req.user._id));
    const normalizedParticipants = Array.from(participantSet);

    // Team/own scope user should only chat with allowed users.
    if (!['super_admin', 'admin'].includes(req.user.role) && req.dataScope !== 'organization') {
      const allowedIds = await resolveTeamUserIds(req);
      const allowed = new Set(allowedIds.map(String));
      const invalid = normalizedParticipants.filter((id) => !allowed.has(String(id)));
      if (invalid.length > 0) {
        return res.status(403).json({ success: false, message: 'Some participants are outside your allowed scope' });
      }
    }

    // If direct chat with exactly 2 users, reuse existing conversation
    if (type === 'direct' && normalizedParticipants.length === 2) {
      const existing = await ChatConversation.findOne({
        type: 'direct',
        participants: { $all: normalizedParticipants, $size: 2 },
        isArchived: false,
      }).populate('participants', 'name email role avatar department');
      if (existing) return res.status(200).json({ success: true, conversation: existing, reused: true });
    }

    const conversation = await ChatConversation.create({
      title,
      type,
      participants: normalizedParticipants,
      createdBy: req.user._id,
      project: projectId || null,
      lastMessageAt: new Date(),
    });

    const populated = await ChatConversation.findById(conversation._id)
      .populate('participants', 'name email role avatar department')
      .populate('createdBy', 'name email role');

    res.status(201).json({ success: true, conversation: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/chat/conversations/:id/members
exports.getConversationMembers = async (req, res) => {
  try {
    const conversation = await ChatConversation.findById(req.params.id)
      .populate('participants', 'name email role avatar department isActive')
      .populate('createdBy', 'name email role');

    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!conversation.participants || conversation.participants.length === 0) {
      await disposeConversation(conversation._id);
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!hasConversationAccess(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to view members' });
    }

    res.json({
      success: true,
      conversation: {
        _id: conversation._id,
        title: conversation.title,
        type: conversation.type,
        createdBy: conversation.createdBy,
      },
      members: conversation.participants,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/conversations/:id/leave
exports.leaveConversation = async (req, res) => {
  try {
    const conversation = await ChatConversation.findById(req.params.id);
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!hasConversationAccess(req, conversation)) {
      return res.status(403).json({ success: false, message: 'You are not a member of this conversation' });
    }

    const beforeCount = conversation.participants.length;
    conversation.participants = conversation.participants.filter((p) => String(p) !== String(req.user._id));

    if (conversation.participants.length === beforeCount) {
      return res.status(400).json({ success: false, message: 'You are not a participant in this conversation' });
    }

    const disposed = await disposeConversationIfEmpty(conversation);
    if (!disposed) {
      await conversation.save();
    }

    res.json({
      success: true,
      message: disposed ? 'You left the conversation. Empty chat was disposed.' : 'You left the conversation',
      disposed,
      conversationId: conversation._id,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/chat/conversations/:id/messages
exports.getMessages = async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    const conversation = await ChatConversation.findById(req.params.id).select('participants isArchived');
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!hasConversationAccess(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this conversation' });
    }

    const query = { conversation: conversation._id, deletedAt: null };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await ChatMessage.find(query)
      .populate('sender', 'name email role avatar')
      .populate('mentions', 'name email role avatar')
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json({ success: true, messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/conversations/:id/messages
exports.sendMessage = async (req, res) => {
  try {
    const { body, attachments = [], mentionIds = [] } = req.body;
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: 'Message body is required' });
    }

    const conversation = await ChatConversation.findById(req.params.id).select('participants isArchived');
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!hasConversationAccess(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to send in this conversation' });
    }

    const participantSet = new Set(conversation.participants.map((p) => String(p)));
    const mentions = Array.isArray(mentionIds)
      ? Array.from(new Set(mentionIds.map(String))).filter((id) => participantSet.has(id) && id !== String(req.user._id))
      : [];

    const message = await ChatMessage.create({
      conversation: conversation._id,
      sender: req.user._id,
      body: String(body).trim(),
      attachments,
      mentions,
    });

    await ChatConversation.findByIdAndUpdate(conversation._id, {
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    });

    const populated = await ChatMessage.findById(message._id)
      .populate('sender', 'name email role avatar')
      .populate('mentions', 'name email role avatar');

    if (mentions.length) {
      await notifyMany(
        mentions.map((recipientId) => ({
          recipientId,
          senderId: req.user._id,
          type: 'mentioned',
          title: 'You were mentioned in chat',
          message: `${req.user.name} mentioned you in a conversation`,
          link: `/chat?conversation=${conversation._id}`,
        }))
      );
    }

    res.status(201).json({ success: true, message: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/chat/messages/:messageId
exports.updateMessage = async (req, res) => {
  try {
    const { body, mentionIds = [] } = req.body;
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: 'Message body is required' });
    }

    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.deletedAt) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const conversation = await ChatConversation.findById(message.conversation).select('participants');
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || !hasConversationAccess(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    const canEdit =
      String(message.sender) === String(req.user._id) ||
      ['super_admin', 'admin'].includes(req.user.role);

    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'Only sender or admin can edit this message' });
    }

    const participantSet = new Set(conversation.participants.map((p) => String(p)));
    const previousMentions = new Set((message.mentions || []).map((id) => String(id)));
    const nextMentions = Array.isArray(mentionIds)
      ? Array.from(new Set(mentionIds.map(String))).filter((id) => participantSet.has(id) && id !== String(req.user._id))
      : [];
    const newlyMentioned = nextMentions.filter((id) => !previousMentions.has(id));

    message.body = String(body).trim();
    message.mentions = nextMentions;
    message.editedAt = new Date();
    await message.save();

    const populated = await ChatMessage.findById(message._id)
      .populate('sender', 'name email role avatar')
      .populate('mentions', 'name email role avatar');

    if (newlyMentioned.length) {
      await notifyMany(
        newlyMentioned.map((recipientId) => ({
          recipientId,
          senderId: req.user._id,
          type: 'mentioned',
          title: 'You were mentioned in chat',
          message: `${req.user.name} mentioned you in a conversation`,
          link: `/chat?conversation=${conversation._id}`,
        }))
      );
    }

    res.json({ success: true, message: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/chat/messages/:messageId
exports.deleteMessage = async (req, res) => {
  try {
    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.deletedAt) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const conversation = await ChatConversation.findById(message.conversation).select('participants');
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || !hasConversationAccess(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    const canDelete =
      String(message.sender) === String(req.user._id) ||
      ['super_admin', 'admin', 'manager', 'team_lead'].includes(req.user.role);

    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'Not allowed to delete this message' });
    }

    message.deletedAt = new Date();
    await message.save();

    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
