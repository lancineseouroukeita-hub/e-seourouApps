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
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listUsers));
router.patch('/me/avatar', requireAuth, asyncHandler(updateMyAvatar));
router.patch('/me/name', requireAuth, asyncHandler(updateMyName));
router.patch('/me/password', requireAuth, asyncHandler(updateMyPassword));
router.patch('/me/privacy', requireAuth, asyncHandler(updateMyPrivacy));
router.get('/blocked', requireAuth, asyncHandler(listBlockedUsers));
router.post('/:userId/block', requireAuth, asyncHandler(blockUser));
router.post('/:userId/unblock', requireAuth, asyncHandler(unblockUser));

module.exports = router;
