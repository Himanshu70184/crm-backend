const express = require('express');
const router = express.Router();

const {
  getConversations,
  createConversation,
  getConversationMembers,
  addMembers,
  removeMember,
  setAdmin,
  leaveConversation,
  getMessages,
  sendMessage,
  updateMessage,
  deleteMessage,
} = require('../controllers/chatController');

const { protect, checkPermission, enforceOrganizationModule } = require('../middleware/auth');
const chatUpload = require('../middleware/chatUpload');

router.use(protect);
router.use(enforceOrganizationModule('chat'));

router.get('/conversations', checkPermission('chat', 'read'), getConversations);
router.post('/conversations', checkPermission('chat', 'create'), createConversation);
router.get('/conversations/:id/members', checkPermission('chat', 'read'), getConversationMembers);
router.post('/conversations/:id/members', checkPermission('chat', 'update'), addMembers);
router.delete('/conversations/:id/members/:userId', checkPermission('chat', 'update'), removeMember);
router.put('/conversations/:id/admins/:userId', checkPermission('chat', 'update'), setAdmin);
router.post('/conversations/:id/leave', checkPermission('chat', 'read'), leaveConversation);
router.get('/conversations/:id/messages', checkPermission('chat', 'read'), getMessages);
// chatUpload parses multipart/form-data (text + up to 10 image/video files).
// Plain JSON requests without files pass straight through untouched.
router.post('/conversations/:id/messages', checkPermission('chat', 'create'), chatUpload, sendMessage);
router.put('/messages/:messageId', checkPermission('chat', 'update'), updateMessage);
router.delete('/messages/:messageId', checkPermission('chat', 'delete'), deleteMessage);

module.exports = router;