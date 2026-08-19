const express = require('express');
const { listUsers, updateMyAvatar, updateMyName, updateMyPassword } = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listUsers);
router.patch('/me/avatar', requireAuth, updateMyAvatar);
router.patch('/me/name', requireAuth, updateMyName);
router.patch('/me/password', requireAuth, updateMyPassword);

module.exports = router;
