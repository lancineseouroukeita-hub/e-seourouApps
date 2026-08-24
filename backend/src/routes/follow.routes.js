const express = require('express');
const { followUser, unfollowUser, listFollowSummary } = require('../controllers/follow.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/summary', requireAuth, asyncHandler(listFollowSummary));
router.post('/:userId', requireAuth, asyncHandler(followUser));
router.delete('/:userId', requireAuth, asyncHandler(unfollowUser));

module.exports = router;
