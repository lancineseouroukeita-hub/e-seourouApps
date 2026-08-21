const express = require('express');
const {
  listUsers,
  updateMyAvatar,
  updateMyName,
  updateMyPassword,
  updateMyPrivacy,
  listBlockedUsers,
  blockUser,
  unblockUser,
} = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listUsers);
router.patch('/me/avatar', requireAuth, updateMyAvatar);
router.patch('/me/name', requireAuth, updateMyName);
router.patch('/me/password', requireAuth, updateMyPassword);
router.patch('/me/privacy', requireAuth, updateMyPrivacy);
router.get('/blocked', requireAuth, listBlockedUsers);
router.post('/:userId/block', requireAuth, blockUser);
router.post('/:userId/unblock', requireAuth, unblockUser);

module.exports = router;

