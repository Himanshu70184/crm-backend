const express = require('express');
const router = express.Router();
const { getActivities } = require('../controllers/activityController');
const { protect, authorize, enforceOrganizationModule } = require('../middleware/auth');

router.get('/', protect, enforceOrganizationModule('tasks'), authorize('admin', 'manager'), getActivities);

module.exports = router;
