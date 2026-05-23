const express = require('express');
const router = express.Router();
const { getReports, exportTimeReport } = require('../controllers/reportsController');
const { protect, authorize } = require('../middleware/auth');

router.get('/', protect, authorize('admin', 'manager'), getReports);
router.get('/time-export', protect, exportTimeReport);

module.exports = router;
