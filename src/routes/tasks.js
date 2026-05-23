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
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);
router.get('/', getTasks);
router.post('/', createTask);

router.get('/:id/activities', getTaskActivityLog);
router.get('/:id/timer', getTaskTimer);
router.post('/:id/timer/start', startTimer);
router.post('/:id/timer/pause', pauseTimer);
router.post('/:id/timer/resume', resumeTimer);
router.post('/:id/timer/stop', stopTimer);
router.post('/:id/timer/cancel', cancelTimer);
router.put('/:id/timer/adjust', adjustTimer);
router.post('/:id/timer/log', logTime);

router.get('/:id', getTask);
router.put('/:id', updateTask);
router.put('/:id/status', updateTaskStatus);
router.put('/:id/subtasks', updateSubtasks);
router.delete('/:id', authorize('admin', 'manager'), deleteTask);
router.post('/:id/attachments', upload.single('file'), uploadAttachment);

module.exports = router;
