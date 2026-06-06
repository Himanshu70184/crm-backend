const express = require('express');
const router = express.Router();
const { getReports, exportTimeReport } = require('../controllers/reportsController');
const { protect, authorize, enforceOrganizationModule } = require('../middleware/auth');

router.get('/', protect, enforceOrganizationModule('reports'), authorize('admin', 'manager'), getReports);
router.get('/time-export', protect, enforceOrganizationModule('reports'), exportTimeReport);

module.exports = router;
