const express = require('express');

const router = express.Router();

const {
  getAttendanceRecords,
  clockIn,
  clockOut,
  getTodayAttendance,
  updateLiveWorkedTime,
  getLateCheckIns,
  reviewLateCheckIn,
  getLeaveRequests,
  applyLeave,
  reviewLeave,
  cancelLeaveRequest,
  reconcileAttendance,
  estimateLeaveDays,
  getLeaveRequestEmails,
} = require('../controllers/attendanceController');
const { protect, checkPermission, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('attendance'));

router.get('/today', checkPermission('attendance', 'read'), getTodayAttendance);
router.get('/', checkPermission('attendance', 'read'), getAttendanceRecords);
router.post('/clock-in', checkPermission('attendance', 'create'), clockIn);
router.post('/clock-out', checkPermission('attendance', 'update'), clockOut);
router.put('/today/worked', checkPermission('attendance', 'update'), updateLiveWorkedTime);
router.post('/reconcile', checkPermission('attendance', 'update'), reconcileAttendance);
// Late check-in approval workflow (see attendanceController for the routing
// matrix: HR/Manager requests go to Super Admin/Admin only).
router.get('/late-checkins', checkPermission('attendance', 'read'), getLateCheckIns);
router.put('/late-checkins/:id/review', checkPermission('attendance', 'approve'), reviewLateCheckIn);

router.get('/leaves', checkPermission('leave', 'read'), getLeaveRequests);
router.get('/leaves/estimate', checkPermission('leave', 'create'), estimateLeaveDays);
router.get('/leaves/emails', checkPermission('leave', 'read'), getLeaveRequestEmails);
router.post('/leaves', checkPermission('leave', 'create'), applyLeave);
router.put('/leaves/:id/review', checkPermission('leave', 'approve'), reviewLeave);
router.put('/leaves/:id/cancel', checkPermission('leave', 'update'), cancelLeaveRequest);

module.exports = router;