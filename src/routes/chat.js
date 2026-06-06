const express = require('express');
const router = express.Router();

const {
  getConversations,
  createConversation,
  getConversationMembers,
  leaveConversation,
  getMessages,
  sendMessage,
  updateMessage,
  deleteMessage,
} = require('../controllers/chatController');

const { protect, checkPermission, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('chat'));

router.get('/conversations', checkPermission('chat', 'read'), getConversations);
router.post('/conversations', checkPermission('chat', 'create'), createConversation);
router.get('/conversations/:id/members', checkPermission('chat', 'read'), getConversationMembers);
router.post('/conversations/:id/leave', checkPermission('chat', 'read'), leaveConversation);
router.get('/conversations/:id/messages', checkPermission('chat', 'read'), getMessages);
router.post('/conversations/:id/messages', checkPermission('chat', 'create'), sendMessage);
router.put('/messages/:messageId', checkPermission('chat', 'update'), updateMessage);
router.delete('/messages/:messageId', checkPermission('chat', 'delete'), deleteMessage);

module.exports = router;
