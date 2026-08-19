const express = require('express');
const { listUsers, updateMyAvatar } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listUsers);
router.patch('/me/avatar', requireAuth, updateMyAvatar);

module.exports = router;
