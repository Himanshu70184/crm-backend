const ActiveTimer = require('../models/ActiveTimer');
const TimeLog = require('../models/TimeLog');
const Task = require('../models/Task');
const { logTaskActivity } = require('../services/taskActivityService');

const msToHours = (ms) => Math.round((ms / 3600000) * 100) / 100;

const getElapsedMs = (timer) => {
  let total = timer.accumulatedMs || 0;
  if (timer.status === 'running' && timer.resumedAt) {
    total += Date.now() - new Date(timer.resumedAt).getTime();
  }
  return total;
};

exports.getActiveTimer = async (req, res) => {
  try {
    const timer = await ActiveTimer.findOne({ user: req.user._id })
      .populate('task', 'title')
      .populate('project', 'name');
    if (!timer) return res.json({ success: true, timer: null });

    res.json({
      success: true,
      timer: {
        ...timer.toObject(),
        elapsedMs: getElapsedMs(timer),
        elapsedHours: msToHours(getElapsedMs(timer)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTaskTimer = async (req, res) => {
  try {
    const timer = await ActiveTimer.findOne({ user: req.user._id, task: req.params.id });
    if (!timer) return res.json({ success: true, timer: null, elapsedMs: 0 });
    res.json({
      success: true,
      timer,
      elapsedMs: getElapsedMs(timer),
      elapsedHours: msToHours(getElapsedMs(timer)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.startTimer = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    await ActiveTimer.findOneAndDelete({ user: req.user._id });

    const timer = await ActiveTimer.create({
      user: req.user._id,
      task: task._id,
      project: task.project,
      status: 'running',
      accumulatedMs: 0,
      resumedAt: new Date(),
    });

    await logTaskActivity(req.user, 'Started time tracker', task._id, { taskTitle: task.title });

    res.json({ success: true, timer, elapsedMs: 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.pauseTimer = async (req, res) => {
  try {
    const timer = await ActiveTimer.findOne({ user: req.user._id, task: req.params.id });
    if (!timer) return res.status(404).json({ success: false, message: 'No active timer for this task' });
    if (timer.status === 'paused') {
      return res.json({ success: true, timer, elapsedMs: getElapsedMs(timer) });
    }

    const now = Date.now();
    timer.accumulatedMs += now - new Date(timer.resumedAt).getTime();
    timer.status = 'paused';
    timer.resumedAt = null;
    await timer.save();

    res.json({ success: true, timer, elapsedMs: timer.accumulatedMs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.resumeTimer = async (req, res) => {
  try {
    const timer = await ActiveTimer.findOne({ user: req.user._id, task: req.params.id });
    if (!timer) return res.status(404).json({ success: false, message: 'No timer for this task' });
    if (timer.status === 'running') {
      return res.json({ success: true, timer, elapsedMs: getElapsedMs(timer) });
    }

    timer.status = 'running';
    timer.resumedAt = new Date();
    await timer.save();

    res.json({ success: true, timer, elapsedMs: timer.accumulatedMs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveElapsedToTask = async (user, taskId, projectId, elapsedMs, description) => {
  const hours = msToHours(elapsedMs);
  if (hours < 0.01) {
    return { error: 'Track at least 1 minute before saving' };
  }

  const log = await TimeLog.create({
    user: user._id,
    task: taskId,
    project: projectId,
    hours: Math.max(hours, 0.01),
    date: new Date(),
    description: description || 'Time logged',
  });

  const allLogs = await TimeLog.aggregate([
    { $match: { task: taskId } },
    { $group: { _id: null, total: { $sum: '$hours' } } },
  ]);
  const task = await Task.findByIdAndUpdate(taskId, { loggedHours: allLogs[0]?.total || 0 }, { new: true });

  await logTaskActivity(user, 'Logged time via timer', taskId, {
    hours: log.hours,
    description: log.description,
  });

  await log.populate([{ path: 'user', select: 'name avatar' }]);
  return { log, hours: log.hours, task };
};

exports.adjustTimer = async (req, res) => {
  try {
    const elapsedMs = Math.max(0, Number(req.body?.elapsedMs) || 0);
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    let timer = await ActiveTimer.findOne({ user: req.user._id, task: req.params.id });

    if (!timer) {
      if (elapsedMs === 0) {
        return res.json({ success: true, timer: null, elapsedMs: 0 });
      }
      await ActiveTimer.findOneAndDelete({ user: req.user._id });
      timer = await ActiveTimer.create({
        user: req.user._id,
        task: task._id,
        project: task.project,
        status: 'paused',
        accumulatedMs: elapsedMs,
        resumedAt: null,
      });
      return res.json({ success: true, timer, elapsedMs });
    }

    if (timer.status === 'running' && timer.resumedAt) {
      timer.accumulatedMs += Date.now() - new Date(timer.resumedAt).getTime();
      timer.status = 'paused';
      timer.resumedAt = null;
    }

    timer.accumulatedMs = elapsedMs;
    await timer.save();

    res.json({ success: true, timer, elapsedMs: timer.accumulatedMs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.logTime = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const active = await ActiveTimer.findOne({ user: req.user._id, task: req.params.id });
    let elapsedMs =
      req.body?.elapsedMs != null ? Math.max(0, Number(req.body.elapsedMs)) : active ? getElapsedMs(active) : 0;

    if (active) await ActiveTimer.findByIdAndDelete(active._id);

    if (elapsedMs < 60000) {
      return res.status(400).json({
        success: false,
        message: 'Enter at least 1 minute (00:01:00) on the timer',
      });
    }

    const result = await saveElapsedToTask(
      req.user,
      task._id,
      task.project,
      elapsedMs,
      req.body?.description || 'Time logged'
    );
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    res.json({
      success: true,
      message: `${result.hours}h added to task`,
      log: result.log,
      task: result.task,
      elapsedMs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.stopTimer = async (req, res) => {
  try {
    const timer = await ActiveTimer.findOne({ user: req.user._id, task: req.params.id });
    if (!timer) return res.status(404).json({ success: false, message: 'No active timer' });

    let elapsedMs = getElapsedMs(timer);
    if (req.body?.elapsedMs != null) {
      elapsedMs = Math.max(0, Number(req.body.elapsedMs));
    }
    const hours = msToHours(elapsedMs);

    if (hours < 0.01) {
      await ActiveTimer.findByIdAndDelete(timer._id);
      return res.status(400).json({
        success: false,
        message: 'Track at least 1 minute before stopping',
      });
    }

    await ActiveTimer.findByIdAndDelete(timer._id);

    const result = await saveElapsedToTask(
      req.user,
      timer.task,
      timer.project,
      elapsedMs,
      req.body?.description || 'Timer session'
    );

    res.json({
      success: true,
      message: `${result.hours}h added to task`,
      log: result.log,
      task: result.task,
      elapsedMs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.cancelTimer = async (req, res) => {
  try {
    const timer = await ActiveTimer.findOneAndDelete({ user: req.user._id, task: req.params.id });
    if (!timer) return res.status(404).json({ success: false, message: 'No active timer' });
    res.json({ success: true, message: 'Timer discarded — no time logged' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
