const express = require('express');
const router = express.Router();
const { getActivities } = require('../controllers/activityController');
const { protect, authorize } = require('../middleware/auth');

router.get('/', protect, authorize('admin', 'manager'), getActivities);

module.exports = router;
