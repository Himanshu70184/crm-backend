const express = require('express');
const router = express.Router();
const {
  getTimeLogs, createTimeLog, updateTimeLog, deleteTimeLog, getTimelogSummary,
} = require('../controllers/timeLogController');
const { protect, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('timeTracking'));
router.get('/summary', getTimelogSummary);
router.get('/', getTimeLogs);
router.post('/', createTimeLog);
router.put('/:id', updateTimeLog);
router.delete('/:id', deleteTimeLog);

module.exports = router;
