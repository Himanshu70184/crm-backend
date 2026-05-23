const express = require('express');
const router = express.Router();
const {
  getSettings, updateSettings, getPublicBranding, testEmail, getEmailStatus,
  getKanbanColumns, updateKanbanColumns,
} = require('../controllers/settingsController');
const { protect, authorize } = require('../middleware/auth');

router.get('/public', getPublicBranding);
router.get('/kanban-columns', protect, getKanbanColumns);
router.put('/kanban-columns', protect, authorize('admin', 'manager'), updateKanbanColumns);
router.get('/email-status', protect, authorize('admin'), getEmailStatus);
router.post('/test-email', protect, authorize('admin'), testEmail);
router.get('/', protect, getSettings);
router.put('/', protect, authorize('admin'), updateSettings);

module.exports = router;
