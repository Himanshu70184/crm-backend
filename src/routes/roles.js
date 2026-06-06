const express = require('express');
const router = express.Router();
const {
  getRoles,
  getRole,
  getRoleByName,
  createRole,
  updateRole,
  deleteRole,
  cloneRole,
  getAuditLogs,
  getMyPermissions,
} = require('../controllers/roleController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Any authenticated user can read roles and their own permissions
router.get('/my-permissions', getMyPermissions);
router.get('/audit-logs', authorize('super_admin', 'admin'), getAuditLogs);
router.get('/by-name/:name', getRoleByName);
router.get('/', getRoles);
router.get('/:id', getRole);

// Only super_admin and admin can manage roles
router.post('/', authorize('super_admin', 'admin'), createRole);
router.put('/:id', authorize('super_admin', 'admin'), updateRole);
router.delete('/:id', authorize('super_admin', 'admin'), deleteRole);
router.post('/:id/clone', authorize('super_admin', 'admin'), cloneRole);

module.exports = router;
