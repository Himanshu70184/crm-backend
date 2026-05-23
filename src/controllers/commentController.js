const Comment = require('../models/Comment');
const { notifyMany } = require('../services/notificationService');
const { logTaskActivity } = require('../services/taskActivityService');

// @GET /api/comments?task=&project=
exports.getComments = async (req, res) => {
  try {
    const { task, project } = req.query;
    const query = {};
    if (task) query.task = task;
    if (project) query.project = project;

    const comments = await Comment.find(query)
      .populate('author', 'name email avatar')
      .populate('mentions', 'name email')
      .sort({ createdAt: 1 });

    res.json({ success: true, comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/comments
exports.createComment = async (req, res) => {
  try {
    const comment = await Comment.create({ ...req.body, author: req.user._id });
    await comment.populate('author', 'name email avatar');
    await comment.populate('mentions', 'name email');

    if (comment.task) {
      await logTaskActivity(req.user, 'Added comment', comment.task, {
        preview: comment.text.slice(0, 120),
      });
    }

    if (comment.mentions?.length) {
      await notifyMany(
        comment.mentions
          .filter((id) => id.toString() !== req.user._id.toString())
          .map((userId) => ({
            recipientId: userId,
            senderId: req.user._id,
            type: 'mentioned',
            title: 'You were mentioned',
            message: `${req.user.name} mentioned you in a comment`,
            link: comment.task ? `/tasks/${comment.task}` : `/projects/${comment.project}`,
            relatedTask: comment.task,
            relatedProject: comment.project,
          }))
      );
    }

    res.status(201).json({ success: true, comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/comments/:id
exports.updateComment = async (req, res) => {
  try {
    const comment = await Comment.findOne({ _id: req.params.id, author: req.user._id });
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found or not yours' });

    comment.text = req.body.text;
    comment.isEdited = true;
    await comment.save();
    await comment.populate('author', 'name email avatar');
    await comment.populate('mentions', 'name email');

    res.json({ success: true, comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/comments/:id
exports.deleteComment = async (req, res) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.role !== 'admin') query.author = req.user._id;

    const comment = await Comment.findOneAndDelete(query);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
