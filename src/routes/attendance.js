const express = require('express');

const router = express.Router();

const {
  getAttendanceRecords,
  clockIn,
  clockOut,
  getTodayAttendance,
  getLeaveRequests,
  applyLeave,
  reviewLeave,
  reconcileAttendance,
} = require('../controllers/attendanceController');
const { protect, checkPermission, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('attendance'));

router.get('/today', checkPermission('attendance', 'read'), getTodayAttendance);
router.get('/', checkPermission('attendance', 'read'), getAttendanceRecords);
router.post('/clock-in', checkPermission('attendance', 'create'), clockIn);
router.post('/clock-out', checkPermission('attendance', 'update'), clockOut);
router.post('/reconcile', checkPermission('attendance', 'update'), reconcileAttendance);

router.get('/leaves', checkPermission('leave', 'read'), getLeaveRequests);
router.post('/leaves', checkPermission('leave', 'create'), applyLeave);
router.put('/leaves/:id/review', checkPermission('leave', 'approve'), reviewLeave);

module.exports = router;