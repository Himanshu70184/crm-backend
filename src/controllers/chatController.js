const ChatConversation = require('../models/ChatConversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const Project = require('../models/Project');
const { notifyMany } = require('../services/notificationService');
const { emitConversationEvent, emitUsersEvent } = require('../socket/chatSocket');

// Strict: used everywhere in the normal Chat page. Only actual participants
// get access — admin/super_admin included, no automatic bypass.
function isConversationMember(req, conversation) {
  return conversation.participants.some((p) => String(p) === String(req.user._id));
}

// Looser: used ONLY for message moderation (edit/delete) and the separate
// admin oversight endpoints below. Admin/super_admin pass even if not a member.
function hasModerationAccess(req, conversation) {
  if (['super_admin', 'admin'].includes(req.user.role)) return true;
  return isConversationMember(req, conversation);
}

// Group-admin check: used for group management (add/remove members, assign admins).
// This is intentionally separate from hasModerationAccess — org-wide admin/super_admin
// roles do NOT automatically get group-management rights here; only users listed
// in the conversation's own `admins` array do. This keeps group ownership meaningful
// even for orgs where every user happens to have the 'admin' platform role.
function isGroupAdmin(req, conversation) {
  return (conversation.admins || []).some((a) => String(a) === String(req.user._id));
}

async function disposeConversation(conversationId) {
  await ChatMessage.deleteMany({ conversation: conversationId });
  await ChatConversation.deleteOne({ _id: conversationId });
}

async function disposeConversationIfEmpty(conversation) {
  if (!conversation) return false;
  // Self-chats (Note to Self) should never be auto-disposed even if participants
  // list is empty — they persist until the user explicitly clears them.
  if (conversation.type === 'self') return false;
  if ((conversation.participants || []).length > 0) return false;
  await disposeConversation(conversation._id);
  return true;
}

async function cleanupZeroMemberConversations() {
  // Skip self-type conversations — they are intentionally single-participant
  const empties = await ChatConversation.find({ participants: { $size: 0 }, type: { $ne: 'self' } }).select('_id');
  if (!empties.length) return 0;
  const ids = empties.map((item) => item._id);
  await ChatMessage.deleteMany({ conversation: { $in: ids } });
  await ChatConversation.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

function toIdArray(values = []) {
  return values.map((v) => String(v?._id || v)).filter(Boolean);
}

// Attaches the latest non-deleted message preview to each conversation.
// Uses a single aggregation (no N+1 queries) so the sidebar can show the
// last message body + sender name without an extra request per chat.
async function attachLastMessages(conversations) {
  if (!Array.isArray(conversations) || conversations.length === 0) return conversations;
  const ids = conversations.map((c) => c._id);

  const lastMessages = await ChatMessage.aggregate([
    { $match: { conversation: { $in: ids }, deletedAt: null } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$conversation',
        body: { $first: '$body' },
        attachments: { $first: '$attachments' },
        sender: { $first: '$sender' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'sender',
        foreignField: '_id',
        as: 'senderDoc',
      },
    },
    { $unwind: { path: '$senderDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        body: 1,
        attachments: 1,
        senderName: { $ifNull: ['$senderDoc.name', ''] },
      },
    },
  ]);

  const map = new Map(lastMessages.map((m) => [String(m._id), m]));
  conversations.forEach((c) => {
    const lm = map.get(String(c._id));
    c.lastMessage = lm
      ? {
          body: lm.body || '',
          attachments: lm.attachments || [],
          senderName: lm.senderName || '',
        }
      : null;
  });
  return conversations;
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
    // Normal Chat page: everyone (including admin/super_admin) only sees
    // conversations they are actually a participant of. Full oversight is
    // available separately via getAllConversationsAdmin below.
    const query = { isArchived: false, participants: req.user._id };

    const conversations = await ChatConversation.find(query)
      .populate('participants', 'name email role avatar department')
      .populate('admins', 'name email role avatar')
      .populate('createdBy', 'name email role')
      .populate({ path: 'pinnedMessage', select: 'body sender attachments', populate: { path: 'sender', select: 'name' } })
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

    await attachLastMessages(filtered);

    res.json({ success: true, conversations: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/conversations
exports.createConversation = async (req, res) => {
  try {
    const { title = '', participantIds = [], type = 'group', projectId = null } = req.body;

    // Handle self-chat (Note to Self) — special case with only the current user
    if (type === 'self') {
      // Check if user already has a self-chat, reuse it
      const existing = await ChatConversation.findOne({
        type: 'self',
        participants: { $size: 1, $elemMatch: { $eq: req.user._id } },
        isArchived: false,
      }).populate('participants', 'name email role avatar department');
      if (existing) {
        return res.status(200).json({ success: true, conversation: existing, reused: true });
      }

      const conversation = await ChatConversation.create({
        title: title || '📝 Note to Self',
        type: 'self',
        participants: [req.user._id],
        admins: [],
        createdBy: req.user._id,
        project: null,
        lastMessageAt: new Date(),
      });

      const populated = await ChatConversation.findById(conversation._id)
        .populate('participants', 'name email role avatar department')
        .populate('admins', 'name email role avatar')
        .populate('createdBy', 'name email role');

      return res.status(201).json({ success: true, conversation: populated });
    }

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
      // Group creator becomes the first group admin. Direct chats have no admins.
      admins: type === 'group' ? [req.user._id] : [],
      createdBy: req.user._id,
      project: projectId || null,
      lastMessageAt: new Date(),
    });

    const populated = await ChatConversation.findById(conversation._id)
      .populate('participants', 'name email role avatar department')
      .populate('admins', 'name email role avatar')
      .populate('createdBy', 'name email role');

    emitUsersEvent(
      toIdArray(populated?.participants || normalizedParticipants),
      'chat:conversation-updated',
      { conversationId: String(conversation._id), reason: 'conversation_created' }
    );

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
      .populate('admins', 'name email role avatar')
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

    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to view members' });
    }

    res.json({
      success: true,
      conversation: {
        _id: conversation._id,
        title: conversation.title,
        type: conversation.type,
        createdBy: conversation.createdBy,
        admins: conversation.admins,
      },
      members: conversation.participants,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/conversations/:id/members
// Adds one or more users to an existing group. Only current group admins may do this.
exports.addMembers = async (req, res) => {
  try {
    const { participantIds = [] } = req.body;
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ success: false, message: 'participantIds must be a non-empty array' });
    }

    const conversation = await ChatConversation.findById(req.params.id);
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (conversation.type !== 'group') {
      return res.status(400).json({ success: false, message: 'Members can only be added to group conversations' });
    }
    if (!isGroupAdmin(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Only group admins can add members' });
    }

    // Keep the same team/own-scope restriction createConversation enforces,
    // so members can't be added around that boundary via this endpoint.
    if (!['super_admin', 'admin'].includes(req.user.role) && req.dataScope !== 'organization') {
      const allowedIds = await resolveTeamUserIds(req);
      const allowed = new Set(allowedIds.map(String));
      const invalid = participantIds.filter((id) => !allowed.has(String(id)));
      if (invalid.length > 0) {
        return res.status(403).json({ success: false, message: 'Some users are outside your allowed scope' });
      }
    }

    const existingIds = new Set(conversation.participants.map((p) => String(p)));
    const newIds = Array.from(new Set(participantIds.map(String))).filter((id) => !existingIds.has(id));

    if (newIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Selected users are already in the group' });
    }

    conversation.participants.push(...newIds);
    await conversation.save();

    const populated = await ChatConversation.findById(conversation._id)
      .populate('participants', 'name email role avatar department')
      .populate('admins', 'name email role avatar')
      .populate('createdBy', 'name email role');

    emitUsersEvent(toIdArray(populated.participants), 'chat:conversation-updated', {
      conversationId: String(conversation._id),
      reason: 'members_added',
    });
    emitConversationEvent(conversation._id, 'chat:conversation-updated', { reason: 'members_added' });

    res.json({ success: true, conversation: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/chat/conversations/:id/members/:userId
// Removes a user from a group. Only current group admins may do this.
// Cannot remove the last remaining admin without promoting someone else first.
exports.removeMember = async (req, res) => {
  try {
    const { userId } = req.params;

    const conversation = await ChatConversation.findById(req.params.id);
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (conversation.type !== 'group') {
      return res.status(400).json({ success: false, message: 'Members can only be removed from group conversations' });
    }
    if (!isGroupAdmin(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Only group admins can remove members' });
    }

    const participantIdsBefore = toIdArray(conversation.participants);

    const wasParticipant = conversation.participants.some((p) => String(p) === String(userId));
    if (!wasParticipant) {
      return res.status(400).json({ success: false, message: 'User is not a member of this group' });
    }

    const isTargetAdmin = (conversation.admins || []).some((a) => String(a) === String(userId));
    const remainingAdmins = (conversation.admins || []).filter((a) => String(a) !== String(userId));
    if (isTargetAdmin && remainingAdmins.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the last admin. Promote another member to admin first.',
      });
    }

    conversation.participants = conversation.participants.filter((p) => String(p) !== String(userId));
    conversation.admins = remainingAdmins;

    const disposed = await disposeConversationIfEmpty(conversation);
    if (!disposed) {
      await conversation.save();
    }

    if (disposed) {
      emitUsersEvent(participantIdsBefore, 'chat:conversation-updated', {
        conversationId: String(conversation._id),
        reason: 'conversation_disposed',
      });
      return res.json({ success: true, message: 'Member removed. Empty chat was disposed.', disposed: true });
    }

    const populated = await ChatConversation.findById(conversation._id)
      .populate('participants', 'name email role avatar department')
      .populate('admins', 'name email role avatar')
      .populate('createdBy', 'name email role');

    emitUsersEvent(
      Array.from(new Set([...participantIdsBefore, ...toIdArray(populated.participants), String(userId)])),
      'chat:conversation-updated',
      { conversationId: String(conversation._id), reason: 'member_removed' }
    );
    emitConversationEvent(conversation._id, 'chat:conversation-updated', { reason: 'member_removed' });

    res.json({ success: true, conversation: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/chat/conversations/:id/admins/:userId
// Promotes or revokes a member's group-admin status. Only current admins may do this.
exports.setAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isAdmin } = req.body;

    const conversation = await ChatConversation.findById(req.params.id);
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (conversation.type !== 'group') {
      return res.status(400).json({ success: false, message: 'Admins only apply to group conversations' });
    }
    if (!isGroupAdmin(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Only group admins can change admin status' });
    }

    const isParticipant = conversation.participants.some((p) => String(p) === String(userId));
    if (!isParticipant) {
      return res.status(400).json({ success: false, message: 'User is not a member of this group' });
    }

    const currentlyAdmin = (conversation.admins || []).some((a) => String(a) === String(userId));

    if (isAdmin && !currentlyAdmin) {
      conversation.admins.push(userId);
    } else if (!isAdmin && currentlyAdmin) {
      const remaining = (conversation.admins || []).filter((a) => String(a) !== String(userId));
      if (remaining.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot remove the last admin. Promote another member first.',
        });
      }
      conversation.admins = remaining;
    }

    await conversation.save();

    const populated = await ChatConversation.findById(conversation._id)
      .populate('participants', 'name email role avatar department')
      .populate('admins', 'name email role avatar')
      .populate('createdBy', 'name email role');

    emitUsersEvent(toIdArray(populated.participants), 'chat:conversation-updated', {
      conversationId: String(conversation._id),
      reason: 'admins_updated',
    });
    emitConversationEvent(conversation._id, 'chat:conversation-updated', { reason: 'admins_updated' });

    res.json({ success: true, conversation: populated });
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
    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'You are not a member of this conversation' });
    }

    const participantIdsBefore = toIdArray(conversation.participants);

    const beforeCount = conversation.participants.length;
    conversation.participants = conversation.participants.filter((p) => String(p) !== String(req.user._id));

    if (conversation.participants.length === beforeCount) {
      return res.status(400).json({ success: false, message: 'You are not a participant in this conversation' });
    }

    // If the person leaving was the last admin, promote the earliest-added
    // remaining participant so the group is never left admin-less.
    const wasAdmin = (conversation.admins || []).some((a) => String(a) === String(req.user._id));
    conversation.admins = (conversation.admins || []).filter((a) => String(a) !== String(req.user._id));
    if (wasAdmin && conversation.admins.length === 0 && conversation.participants.length > 0) {
      conversation.admins = [conversation.participants[0]];
    }

    const disposed = await disposeConversationIfEmpty(conversation);
    if (!disposed) {
      await conversation.save();
    }

    if (disposed) {
      emitUsersEvent(participantIdsBefore, 'chat:conversation-updated', {
        conversationId: String(conversation._id),
        reason: 'conversation_disposed',
      });
    } else {
      emitUsersEvent(
        Array.from(new Set([...participantIdsBefore, ...toIdArray(conversation.participants)])),
        'chat:conversation-updated',
        { conversationId: String(conversation._id), reason: 'member_left' }
      );
      emitConversationEvent(conversation._id, 'chat:conversation-updated', { reason: 'member_left' });
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
    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this conversation' });
    }

    const query = { conversation: conversation._id, deletedAt: null };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await ChatMessage.find(query)
      .populate('sender', 'name email role avatar')
      .populate('mentions', 'name email role avatar')
      .populate({
        path: 'replyTo',
        select: 'body sender attachments deletedAt',
        populate: { path: 'sender', select: 'name' },
      })
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json({ success: true, messages: messages.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/chat/conversations/:id/messages/count
exports.getMessageCount = async (req, res) => {
  try {
    const conversation = await ChatConversation.findById(req.params.id).select('participants isArchived');
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to view this conversation' });
    }

    const count = await ChatMessage.countDocuments({ conversation: conversation._id, deletedAt: null });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/conversations/:id/messages
exports.sendMessage = async (req, res) => {
  try {
    const rawBody = req.body?.body;
    const trimmedBody = rawBody ? String(rawBody).trim() : '';

    // multer (chatUpload middleware) populates req.files for multipart requests.
    // Plain JSON requests (no attachments) leave req.files undefined.
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const attachments = uploadedFiles.map((f) => ({
      filename: f.filename,
      originalname: f.originalname,
      path: `/uploads/chat-attachments/${f.filename}`,
      size: f.size,
      mimetype: f.mimetype,
    }));

    if (!trimmedBody && attachments.length === 0) {
      return res.status(400).json({ success: false, message: 'Message body or attachment is required' });
    }

    const conversation = await ChatConversation.findById(req.params.id).select('participants isArchived');
    if (conversation && await disposeConversationIfEmpty(conversation)) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not allowed to send in this conversation' });
    }

    // mentionIds arrives as a real array for JSON requests, but as
    // repeated `mentionIds[]` form fields for multipart requests — multer
    // already collapses those into an array, but guard against a lone string too.
    const rawMentionIds = req.body?.mentionIds ?? req.body?.['mentionIds[]'] ?? [];
    const mentionIdsInput = Array.isArray(rawMentionIds) ? rawMentionIds : [rawMentionIds];

    const participantSet = new Set(conversation.participants.map((p) => String(p)));
    const mentions = Array.from(new Set(mentionIdsInput.map(String)))
      .filter((id) => id && participantSet.has(id) && id !== String(req.user._id));

    // Validate the reply target belongs to the same conversation (and isn't deleted)
    // so a message can't be spoofed as replying to something from another chat.
    let replyTo = null;
    const replyToId = req.body?.replyToId;
    if (replyToId) {
      const target = await ChatMessage.findOne({
        _id: replyToId,
        conversation: conversation._id,
        deletedAt: null,
      }).select('_id');
      if (target) replyTo = target._id;
    }

    const message = await ChatMessage.create({
      conversation: conversation._id,
      sender: req.user._id,
      body: trimmedBody,
      attachments,
      mentions,
      replyTo,
    });

    await ChatConversation.findByIdAndUpdate(conversation._id, {
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    });

    const populated = await ChatMessage.findById(message._id)
      .populate('sender', 'name email role avatar')
      .populate('mentions', 'name email role avatar')
      .populate({
        path: 'replyTo',
        select: 'body sender attachments deletedAt',
        populate: { path: 'sender', select: 'name' },
      });

    if (mentions.length) {
      await notifyMany(
        mentions.map((recipientId) => ({
          recipientId,
          senderId: req.user._id,
          type: 'mentioned',
          title: 'You were mentioned in chat',
          message: `${req.user.name} mentioned you in a conversation`,
          link: `/chat?conversation=${conversation._id}&message=${message._id}`,
        }))
      );
    }

    emitConversationEvent(conversation._id, 'chat:message-created', {
      conversationId: String(conversation._id),
      message: populated,
    });
    emitUsersEvent(toIdArray(conversation.participants), 'chat:conversation-updated', {
      conversationId: String(conversation._id),
      reason: 'message_created',
    });

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
    if (!conversation || !hasModerationAccess(req, conversation)) {
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
      .populate('mentions', 'name email role avatar')
      .populate({
        path: 'replyTo',
        select: 'body sender attachments deletedAt',
        populate: { path: 'sender', select: 'name' },
      });

    if (newlyMentioned.length) {
      await notifyMany(
        newlyMentioned.map((recipientId) => ({
          recipientId,
          senderId: req.user._id,
          type: 'mentioned',
          title: 'You were mentioned in chat',
          message: `${req.user.name} mentioned you in a conversation`,
          link: `/chat?conversation=${conversation._id}&message=${message._id}`,
        }))
      );
    }

    emitConversationEvent(conversation._id, 'chat:message-updated', {
      conversationId: String(conversation._id),
      message: populated,
    });
    emitUsersEvent(toIdArray(conversation.participants), 'chat:conversation-updated', {
      conversationId: String(conversation._id),
      reason: 'message_updated',
    });

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
    if (!conversation || !hasModerationAccess(req, conversation)) {
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

    emitConversationEvent(conversation._id, 'chat:message-deleted', {
      conversationId: String(conversation._id),
      messageId: String(message._id),
    });
    emitUsersEvent(toIdArray(conversation.participants), 'chat:conversation-updated', {
      conversationId: String(conversation._id),
      reason: 'message_deleted',
    });

    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/messages/:messageId/pin
// Pins a message in a conversation. For group chats the pin is stored on the
// conversation (everyone-scope). For direct chats the pin is self-scope (managed
// client-side), so this endpoint is only meaningful for group conversations.
exports.pinMessage = async (req, res) => {
  try {
    const { scope = 'everyone' } = req.body;

    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.deletedAt) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const conversation = await ChatConversation.findById(message.conversation);
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not a member of this conversation' });
    }

    // For 'everyone' scope (group chats), store the pin on the conversation.
    // For 'self' scope (direct chats), pin is managed client-side.
    if (scope === 'everyone') {
      conversation.pinnedMessage = message._id;
      await conversation.save();

      emitConversationEvent(conversation._id, 'chat:pin-updated', {
        conversationId: String(conversation._id),
        pinnedMessageId: String(message._id),
      });
      emitUsersEvent(toIdArray(conversation.participants), 'chat:conversation-updated', {
        conversationId: String(conversation._id),
        reason: 'pin_updated',
      });
    }

    res.json({ success: true, message: 'Message pinned' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/chat/messages/:messageId/unpin
// Unpins a message in a conversation.
exports.unpinMessage = async (req, res) => {
  try {
    const { scope = 'everyone' } = req.body;

    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.deletedAt) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const conversation = await ChatConversation.findById(message.conversation);
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    if (!isConversationMember(req, conversation)) {
      return res.status(403).json({ success: false, message: 'Not a member of this conversation' });
    }

    if (scope === 'everyone') {
      conversation.pinnedMessage = null;
      await conversation.save();

      emitConversationEvent(conversation._id, 'chat:pin-updated', {
        conversationId: String(conversation._id),
        pinnedMessageId: null,
      });
      emitUsersEvent(toIdArray(conversation.participants), 'chat:conversation-updated', {
        conversationId: String(conversation._id),
        reason: 'pin_updated',
      });
    }

    res.json({ success: true, message: 'Message unpinned' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------------------------------------
// Admin oversight (separate panel only — NOT used by the normal Chat page).
// Route these behind admin/super_admin-only middleware, e.g.:
//   router.get('/admin/conversations', authorize('super_admin', 'admin'), chatController.getAllConversationsAdmin);
//   router.get('/admin/conversations/:id/messages', authorize('super_admin', 'admin'), chatController.getConversationMessagesAdmin);
// ---------------------------------------------------------------------------

// GET /api/chat/admin/conversations
exports.getAllConversationsAdmin = async (req, res) => {
  try {
    if (!['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    await cleanupZeroMemberConversations();

    const { search = '' } = req.query;
    const conversations = await ChatConversation.find({ isArchived: false })
      .populate('participants', 'name email role avatar department')
      .populate('admins', 'name email role avatar')
      .populate('createdBy', 'name email role')
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(500);

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

    await attachLastMessages(filtered);

    res.json({ success: true, conversations: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/chat/admin/conversations/:id/messages
exports.getConversationMessagesAdmin = async (req, res) => {
  try {
    if (!['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { before, limit = 50 } = req.query;
    const conversation = await ChatConversation.findById(req.params.id).select('participants isArchived');
    if (!conversation || conversation.isArchived) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
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