const Project = require('../models/Project');
const Task = require('../models/Task');
const { notifyMany } = require('../services/notificationService');
const { normalizeKanbanColumns, slugifyColumnId, getKanbanColumnsFromProject } = require('../utils/kanbanColumns');

const normalizeId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value._id?.toString?.() || value.toString();
};

const uniqIds = (values) => Array.from(new Set(values.map(normalizeId).filter(Boolean)));

const buildProjectAssignmentNotifications = ({
  project,
  actor,
  ownerIds = [],
  teamIds = [],
}) => {
  const actorId = normalizeId(actor?._id);
  const projectId = project?._id;
  const items = [];

  ownerIds.forEach((recipientId) => {
    if (!recipientId || recipientId === actorId) return;
    items.push({
      recipientId,
      senderId: actorId,
      type: 'project_updated',
      title: 'Project assigned to you',
      message: `${actor.name} assigned you as owner of project: ${project.name}`,
      link: `/projects/${projectId}`,
      relatedProject: projectId,
    });
  });

  teamIds.forEach((recipientId) => {
    if (!recipientId || recipientId === actorId) return;
    items.push({
      recipientId,
      senderId: actorId,
      type: 'project_updated',
      title: 'Added to project',
      message: `${actor.name} added you to project: ${project.name}`,
      link: `/projects/${projectId}`,
      relatedProject: projectId,
    });
  });

  return items;
};

// @GET /api/projects
exports.getProjects = async (req, res) => {
  try {
    const { status, search, client, page = 1, limit = 20 } = req.query;
    const query = {};
    const isElevated = ['super_admin', 'admin'].includes(req.user.role);

    if (req.user.role === 'client') {
      query['client.email'] = req.user.email;
    } else if (!isElevated) {
      query.$or = [{ owner: req.user._id }, { team: req.user._id }];
    }
    if (status) query.status = status;
    if (search) query.name = new RegExp(search, 'i');
    if (client) query['client.name'] = client;

    const total = await Project.countDocuments(query);
    const projects = await Project.find(query)
      .populate('owner', 'name email avatar')
      .populate('team', 'name email avatar role')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    res.json({ success: true, total, page: Number(page), projects });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/clients
// Returns distinct client names for populating the filter dropdown
exports.getProjectClients = async (req, res) => {
  try {
    const isElevated = ['super_admin', 'admin'].includes(req.user.role);
    const query = {};

    if (req.user.role === 'client') {
      query['client.email'] = req.user.email;
    } else if (!isElevated) {
      query.$or = [{ owner: req.user._id }, { team: req.user._id }];
    }

    const clientNames = await Project.distinct('client.name', query);
    res.json({ success: true, clients: clientNames.filter(Boolean).sort() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/:id
exports.getProject = async (req, res) => {
  try {
    const isElevated = ['super_admin', 'admin'].includes(req.user.role);
    const project = await Project.findById(req.params.id)
      .populate('owner', 'name email avatar')
      .populate('team', 'name email avatar role');

    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (req.user.role === 'client') {
      if (project.client?.email !== req.user.email) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    } else if (!isElevated) {
      const userId = normalizeId(req.user._id);
      const ownerId = normalizeId(project.owner);
      const teamIds = (project.team || []).map(normalizeId).filter(Boolean);
      const isMember =
        ownerId === userId ||
        teamIds.includes(userId);
      if (!isMember) return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Task summary
    const taskCounts = await Task.aggregate([
      { $match: { project: project._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    res.json({ success: true, project, taskCounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/projects
exports.createProject = async (req, res) => {
  try {
    const project = await Project.create({ ...req.body, owner: req.user._id });
    await project.populate([
      { path: 'owner', select: 'name email avatar' },
      { path: 'team', select: 'name email avatar role' },
    ]);

    const notifications = buildProjectAssignmentNotifications({
      project,
      actor: req.user,
      teamIds: uniqIds(project.team || []),
    });

    if (notifications.length) {
      await notifyMany(notifications);
    }

    res.status(201).json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/projects/:id
exports.updateProject = async (req, res) => {
  try {
    const before = await Project.findById(req.params.id).select('owner team name');
    if (!before) return res.status(404).json({ success: false, message: 'Project not found' });

    const project = await Project.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate('owner', 'name email avatar')
      .populate('team', 'name email avatar role');

    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const previousOwnerId = normalizeId(before.owner);
    const nextOwnerId = normalizeId(project.owner);
    const previousTeamIds = new Set(uniqIds(before.team || []));
    const nextTeamIds = uniqIds(project.team || []);
    const newTeamIds = nextTeamIds.filter((memberId) => !previousTeamIds.has(memberId));
    const newOwnerIds = nextOwnerId && nextOwnerId !== previousOwnerId ? [nextOwnerId] : [];

    const notifications = buildProjectAssignmentNotifications({
      project,
      actor: req.user,
      ownerIds: newOwnerIds,
      teamIds: newTeamIds.filter((memberId) => memberId !== nextOwnerId),
    });

    if (notifications.length) {
      await notifyMany(notifications);
    }

    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/projects/:id
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    await Task.deleteMany({ project: req.params.id });
    res.json({ success: true, message: 'Project and its tasks deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Cleans up milestone payloads before they hit Mongoose:
// - empty-string dates ("") throw a CastError on a Date path, which
//   silently fails the whole project.save() call — convert to undefined
// - budget/taxRate coerced to numbers so stray strings don't slip through
const sanitizeMilestones = (milestones = []) =>
  milestones.map((m) => ({
    ...m,
    startDate: m.startDate ? m.startDate : undefined,
    endDate: m.endDate ? m.endDate : undefined,
    dueDate: m.dueDate ? m.dueDate : undefined,
    budget: Number(m.budget) || 0,
    taxRate: Number(m.taxRate) || 0,
  }));

// @PUT /api/projects/:id/milestones
exports.updateMilestones = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const nextMilestones = sanitizeMilestones(req.body.milestones);

    const totalMilestoneBudget = nextMilestones.reduce((sum, m) => sum + (m.budget || 0), 0);
    const projectBudget = project.budget || 0;
    if (totalMilestoneBudget > projectBudget) {
      return res.status(400).json({
        success: false,
        message: `Milestone budgets ($${totalMilestoneBudget.toLocaleString()}) exceed the project budget ($${projectBudget.toLocaleString()}).`,
      });
    }

    project.milestones = nextMilestones;

    // Revenue = sum of (budget - tax) for milestones marked as completed.
    // Recomputed from scratch each time so it stays accurate even if a
    // milestone's status or amounts are edited after being completed.
    project.revenue = project.milestones.reduce((sum, m) => {
      if (m.status !== 'completed') return sum;
      const budget = m.budget || 0;
      const tax = (budget * (m.taxRate || 0)) / 100;
      return sum + (budget - tax);
    }, 0);

    await project.save();

    res.json({ success: true, milestones: project.milestones, revenue: project.revenue });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/projects/:id/kanban
exports.updateKanbanConfig = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const rawColumns = req.body?.columns || req.body?.kanbanConfig?.columns;
    if (!Array.isArray(rawColumns) || rawColumns.length < 1) {
      return res.status(400).json({ success: false, message: 'At least one Kanban phase is required' });
    }

    const ids = new Set();
    for (const col of rawColumns) {
      const id = (col.id || slugifyColumnId(col.label)).trim();
      if (ids.has(id)) {
        return res.status(400).json({ success: false, message: `Duplicate phase id: ${id}` });
      }
      ids.add(id);
      col.id = id;
    }

    const normalized = normalizeKanbanColumns(rawColumns);
    const oldColumns = getKanbanColumnsFromProject(project);
    const removedIds = oldColumns.map((c) => c.id).filter((id) => !normalized.some((n) => n.id === id));
    const fallbackId = normalized[0].id;

    if (removedIds.length) {
      await Task.updateMany(
        { project: project._id, status: { $in: removedIds } },
        { $set: { status: fallbackId } }
      );
    }

    project.kanbanConfig = {
      ...(project.kanbanConfig?.toObject?.() || project.kanbanConfig || {}),
      ...(req.body.kanbanConfig || {}),
      columns: normalized,
    };

    await project.save();
    require('../services/kanbanService').clearColumnCache(project._id);

    res.json({ success: true, kanbanConfig: project.kanbanConfig, columns: normalized });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/projects/:id/stats
exports.getProjectStats = async (req, res) => {
  try {
    const tasks = await Task.aggregate([
      { $match: { project: require('mongoose').Types.ObjectId.createFromHexString(req.params.id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const totalHours = await require('../models/TimeLog').aggregate([
      { $match: { project: require('mongoose').Types.ObjectId.createFromHexString(req.params.id) } },
      { $group: { _id: null, total: { $sum: '$hours' } } },
    ]);
    res.json({ success: true, tasks, totalHours: totalHours[0]?.total || 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};