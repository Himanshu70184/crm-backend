const Task = require('../models/Task');
const Project = require('../models/Project');
const { notifyUser } = require('../services/notificationService');
const { validateTaskStatus, getWipLimit, getCompletedColumnIds, getActiveColumns } = require('../services/kanbanService');
const { logTaskActivity, getTaskActivities } = require('../services/taskActivityService');

const phaseLabel = async (statusId) => {
  const cols = await getActiveColumns();
  return cols.find((c) => c.id === statusId)?.label || statusId;
};

// @GET /api/tasks
exports.getTasks = async (req, res) => {
  try {
    const { project, status, priority, assignee, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (project) query.project = project;
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (assignee) query.assignee = assignee;
    if (search) query.title = new RegExp(search, 'i');

    // Members only see tasks in their projects
    if (req.user.role === 'member') {
      const userProjects = await Project.find({
        $or: [{ owner: req.user._id }, { team: req.user._id }],
      }).select('_id');
      const allowedProjectIds = userProjects.map((entry) => entry._id.toString());

      if (project) {
        if (!allowedProjectIds.includes(String(project))) {
          return res.json({ success: true, total: 0, tasks: [] });
        }
        query.project = project;
      } else {
        query.project = { $in: userProjects.map((entry) => entry._id) };
      }
    }

    const total = await Task.countDocuments(query);
    const tasks = await Task.find(query)
      .populate('assignee', 'name email avatar')
      .populate('reporter', 'name email avatar')
      .populate('project', 'name')
      .skip((page - 1) * limit)
      .limit(Math.min(Number(limit) || 50, 500))
      .sort({ order: 1, createdAt: -1 });

    res.json({ success: true, total, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/tasks/:id
exports.getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignee', 'name email avatar role')
      .populate('reporter', 'name email avatar')
      .populate('project', 'name status')
      .populate('subtasks.assignee', 'name email avatar');

    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/tasks
exports.createTask = async (req, res) => {
  try {
    const body = { ...req.body, reporter: req.user._id };
    if (body.status) {
      const { valid, fallback } = await validateTaskStatus(body.status);
      if (!valid) body.status = fallback;
    } else {
      body.status = 'todo';
    }
    const task = await Task.create(body);
    await task.populate([
      { path: 'assignee', select: 'name email avatar' },
      { path: 'project', select: 'name' },
    ]);

    await logTaskActivity(req.user, 'Created task', task._id, {
      title: task.title,
      projectName: task.project?.name,
      priority: task.priority,
    });

    if (task.assignee && task.assignee._id.toString() !== req.user._id.toString()) {
      await notifyUser({
        recipientId: task.assignee._id,
        senderId: req.user._id,
        type: 'task_assigned',
        title: 'New task assigned',
        message: `${req.user.name} assigned you: ${task.title}`,
        link: `/tasks/${task._id}`,
        relatedTask: task._id,
        relatedProject: task.project._id,
      });
    }

    res.status(201).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/tasks/:id/activities
exports.getTaskActivityLog = async (req, res) => {
  try {
    const activities = await getTaskActivities(req.params.id);
    res.json({ success: true, activities });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id
exports.updateTask = async (req, res) => {
  try {
    const before = await Task.findById(req.params.id).populate('assignee', 'name');
    if (!before) return res.status(404).json({ success: false, message: 'Task not found' });

    const allowed = ['title', 'description', 'priority', 'dueDate', 'assignee', 'estimatedHours', 'tags', 'order'];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'assignee')) {
      const raw = updates.assignee;
      updates.assignee = raw && String(raw).trim() ? raw : null;
    }

    const task = await Task.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('assignee', 'name email avatar role')
      .populate('reporter', 'name email avatar')
      .populate('project', 'name');

    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const changes = [];
    if (before.title !== task.title) changes.push(`title → "${task.title}"`);
    if (before.description !== task.description) changes.push('description updated');
    if (before.priority !== task.priority) changes.push(`priority → ${task.priority}`);
    const beforeDue = before.dueDate ? new Date(before.dueDate).toISOString().slice(0, 10) : '';
    const afterDue = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '';
    if (beforeDue !== afterDue) changes.push(afterDue ? `due date → ${afterDue}` : 'due date removed');

    const beforeAssigneeId = String(before.assignee?._id || before.assignee || '');
    const afterAssigneeId = String(task.assignee?._id || task.assignee || '');
    if (beforeAssigneeId !== afterAssigneeId) {
      changes.push(task.assignee ? `assigned to ${task.assignee.name}` : 'unassigned');

      if (task.assignee && afterAssigneeId !== req.user._id.toString()) {
        await notifyUser({
          recipientId: task.assignee._id,
          senderId: req.user._id,
          type: 'task_assigned',
          title: 'Task assigned to you',
          message: `${req.user.name} assigned you: ${task.title}`,
          link: `/tasks/${task._id}`,
          relatedTask: task._id,
          relatedProject: task.project?._id || task.project,
        });
      }
    }

    if (changes.length) {
      await logTaskActivity(req.user, 'Updated task', task._id, { changes: changes.join(', ') });
    }

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id/status  (Kanban move)
exports.updateTaskStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const existing = await Task.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Task not found' });

    const { valid, columns } = await validateTaskStatus(status);
    if (!valid) {
      return res.status(400).json({
        success: false,
        message: `Invalid phase. Allowed: ${columns.map((c) => c.label).join(', ')}`,
      });
    }

    const wipLimit = await getWipLimit(status);
    if (wipLimit != null && existing.status !== status) {
      const countInColumn = await Task.countDocuments({
        project: existing.project,
        status,
        _id: { $ne: existing._id },
      });
      if (countInColumn >= wipLimit) {
        return res.status(400).json({
          success: false,
          message: `WIP limit reached (${wipLimit}) for this phase`,
        });
      }
    }

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    )
      .populate('assignee', 'name email avatar')
      .populate('project', 'name');

    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const fromLabel = await phaseLabel(existing.status);
    const toLabel = await phaseLabel(status);
    await logTaskActivity(req.user, 'Moved task', task._id, {
      from: existing.status,
      to: status,
      fromLabel,
      toLabel,
    });

    const projectId = task.project?._id || task.project || existing.project;
    if (projectId) {
      try {
        const completedIds = await getCompletedColumnIds();
        const allTasks = await Task.find({ project: projectId });
        const completed = allTasks.filter((t) => completedIds.includes(t.status)).length;
        const progress = allTasks.length ? Math.round((completed / allTasks.length) * 100) : 0;
        await Project.findByIdAndUpdate(projectId, { progress });
      } catch (progressErr) {
        console.error('Project progress update skipped:', progressErr.message);
      }
    }

    res.json({ success: true, task });
  } catch (err) {
    console.error('updateTaskStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/tasks/:id
exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    await logTaskActivity(req.user, 'Deleted task', req.params.id, { title: task.title });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/tasks/:id/attachments
exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          attachments: {
            filename: req.file.filename,
            originalname: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
            size: req.file.size,
            uploadedBy: req.user._id,
          },
        },
      },
      { new: true }
    );
    res.json({ success: true, attachments: task.attachments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/tasks/:id/subtasks
exports.updateSubtasks = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { subtasks: req.body.subtasks },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, subtasks: task.subtasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
