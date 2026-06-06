const express = require('express');
const router = express.Router();
const { getComments, createComment, updateComment, deleteComment } = require('../controllers/commentController');
const { protect, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('tasks'));
router.get('/', getComments);
router.post('/', createComment);
router.put('/:id', updateComment);
router.delete('/:id', deleteComment);

module.exports = router;
