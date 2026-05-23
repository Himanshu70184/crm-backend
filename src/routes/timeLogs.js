const express = require('express');
const router = express.Router();
const {
  getTimeLogs, createTimeLog, updateTimeLog, deleteTimeLog, getTimelogSummary,
} = require('../controllers/timeLogController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/summary', getTimelogSummary);
router.get('/', getTimeLogs);
router.post('/', createTimeLog);
router.put('/:id', updateTimeLog);
router.delete('/:id', deleteTimeLog);

module.exports = router;
