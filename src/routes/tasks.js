const express = require('express');
const router = express.Router();
const {
  getTasks, getTask, createTask, updateTask, updateTaskStatus,
  deleteTask, uploadAttachment, updateSubtasks, getTaskActivityLog,
} = require('../controllers/taskController');
const {
  getTaskTimer, startTimer, pauseTimer, resumeTimer, stopTimer, cancelTimer,
  adjustTimer, logTime,
} = require('../controllers/timerController');
const { protect, authorize, enforceOrganizationModule } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);
router.get('/', enforceOrganizationModule('tasks'), getTasks);
router.post('/', enforceOrganizationModule('tasks'), createTask);

router.get('/:id/activities', enforceOrganizationModule('tasks'), getTaskActivityLog);
router.get('/:id/timer', enforceOrganizationModule('timeTracking'), getTaskTimer);
router.post('/:id/timer/start', enforceOrganizationModule('timeTracking'), startTimer);
router.post('/:id/timer/pause', enforceOrganizationModule('timeTracking'), pauseTimer);
router.post('/:id/timer/resume', enforceOrganizationModule('timeTracking'), resumeTimer);
router.post('/:id/timer/stop', enforceOrganizationModule('timeTracking'), stopTimer);
router.post('/:id/timer/cancel', enforceOrganizationModule('timeTracking'), cancelTimer);
router.put('/:id/timer/adjust', enforceOrganizationModule('timeTracking'), adjustTimer);
router.post('/:id/timer/log', enforceOrganizationModule('timeTracking'), logTime);

router.get('/:id', enforceOrganizationModule('tasks'), getTask);
router.put('/:id', enforceOrganizationModule('tasks'), updateTask);
router.put('/:id/status', enforceOrganizationModule('tasks'), updateTaskStatus);
router.put('/:id/subtasks', enforceOrganizationModule('tasks'), updateSubtasks);
router.delete('/:id', enforceOrganizationModule('tasks'), authorize('admin', 'manager'), deleteTask);
router.post('/:id/attachments', enforceOrganizationModule('tasks'), upload.single('file'), uploadAttachment);

module.exports = router;
