const express = require('express');
const {
  listCommunities,
  getCommunity,
  createCommunity,
  createCommunityGroup,
  addCommunityMember,
  removeCommunityMember,
} = require('../controllers/community.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listCommunities));
router.post('/', requireAuth, asyncHandler(createCommunity));
router.get('/:communityId', requireAuth, asyncHandler(getCommunity));
router.post('/:communityId/groups', requireAuth, asyncHandler(createCommunityGroup));
router.post('/:communityId/members', requireAuth, asyncHandler(addCommunityMember));
router.delete('/:communityId/members/:memberUserId', requireAuth, asyncHandler(removeCommunityMember));

module.exports = router;
