const express = require('express');
const router = express.Router();

const {
  getConversations,
  getConversationById,
  createConversation,
  getConversationMembers,
  addMembers,
  removeMember,
  setAdmin,
  leaveConversation,
  getMessages,
  getMessageCount,
  updateConversation,
  sendMessage,
  updateMessage,
  deleteMessage,
  pinMessage,
  unpinMessage,
  markConversationRead,
  getUnreadCount,
} = require('../controllers/chatController');

const { protect, checkPermission, enforceOrganizationModule } = require('../middleware/auth');
const upload = require('../middleware/upload');
const chatUpload = require('../middleware/chatUpload');

router.use(protect);
router.use(enforceOrganizationModule('chat'));

router.get('/conversations', checkPermission('chat', 'read'), getConversations);
router.post('/conversations', checkPermission('chat', 'create'), upload.single('avatar'), createConversation);
router.put('/conversations/:id', checkPermission('chat', 'update'), upload.single('avatar'), updateConversation);
router.get('/conversations/:id', checkPermission('chat', 'read'), getConversationById);
router.get('/conversations/:id/members', checkPermission('chat', 'read'), getConversationMembers);
router.post('/conversations/:id/members', checkPermission('chat', 'update'), addMembers);
router.delete('/conversations/:id/members/:userId', checkPermission('chat', 'update'), removeMember);
router.put('/conversations/:id/admins/:userId', checkPermission('chat', 'update'), setAdmin);
router.post('/conversations/:id/leave', checkPermission('chat', 'read'), leaveConversation);
router.get('/conversations/:id/messages/count', checkPermission('chat', 'read'), getMessageCount);
router.get('/conversations/:id/messages', checkPermission('chat', 'read'), getMessages);
// chatUpload parses multipart/form-data (text + up to 10 image/video files).
// Plain JSON requests without files pass straight through untouched.
router.post('/conversations/:id/messages', checkPermission('chat', 'create'), chatUpload, sendMessage);
// Marks a conversation as read for the current user (resets their unread count).
router.post('/conversations/:id/read', checkPermission('chat', 'read'), markConversationRead);
// Total unread messages across all of the current user's conversations.
router.get('/unread-count', checkPermission('chat', 'read'), getUnreadCount);
router.put('/messages/:messageId', checkPermission('chat', 'update'), updateMessage);
router.delete('/messages/:messageId', checkPermission('chat', 'delete'), deleteMessage);
router.post('/messages/:messageId/pin', checkPermission('chat', 'update'), pinMessage);
router.post('/messages/:messageId/unpin', checkPermission('chat', 'update'), unpinMessage);

module.exports = router;
