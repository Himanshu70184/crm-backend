const express = require('express');
const router = express.Router();
const {
  getProjects, getProject, createProject, updateProject,
  deleteProject, updateMilestones, getProjectStats, updateKanbanConfig,
  getProjectClients,
} = require('../controllers/projectController');
const { protect, authorize, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('projects'));
router.get('/', getProjects);
router.post('/', authorize('admin', 'manager'), createProject);
router.get('/clients', getProjectClients); // must come before /:id
router.get('/:id', getProject);
router.put('/:id', authorize('admin', 'manager'), updateProject);
router.delete('/:id', authorize('admin'), deleteProject);
router.put('/:id/milestones', authorize('admin', 'manager'), updateMilestones);
router.put('/:id/kanban', authorize('admin', 'manager'), updateKanbanConfig);
router.get('/:id/stats', getProjectStats);

module.exports = router;