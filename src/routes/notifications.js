const express = require('express');
const router = express.Router();
const {
  getNotifications, markRead, markAllRead, deleteNotification,
} = require('../controllers/notificationController');
const { protect, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('notifications'));
router.get('/', getNotifications);
router.put('/read-all', markAllRead);
router.put('/:id/read', markRead);
router.delete('/:id', deleteNotification);

module.exports = router;
