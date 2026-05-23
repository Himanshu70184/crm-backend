const express = require('express');
const router = express.Router();
const { getStatus, bootstrapDemoUsers } = require('../controllers/setupController');

router.get('/status', getStatus);
router.post('/bootstrap', bootstrapDemoUsers);

module.exports = router;
