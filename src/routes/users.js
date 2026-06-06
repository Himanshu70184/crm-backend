const express = require('express');
const router = express.Router();
const { getUsers, getUser, createUser, updateUser, deleteUser } = require('../controllers/userController');
const { protect, authorize, enforceOrganizationModule } = require('../middleware/auth');

router.use(protect);
router.use(enforceOrganizationModule('team'));
router.get('/', getUsers);
router.get('/:id', getUser);
router.post('/', authorize('super_admin', 'admin'), createUser);
router.put('/:id', authorize('super_admin', 'admin', 'manager'), updateUser);
router.delete('/:id', authorize('super_admin', 'admin'), deleteUser);

module.exports = router;
