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

const router = express.Router();

router.get('/', requireAuth, listCommunities);
router.post('/', requireAuth, createCommunity);
router.get('/:communityId', requireAuth, getCommunity);
router.post('/:communityId/groups', requireAuth, createCommunityGroup);
router.post('/:communityId/members', requireAuth, addCommunityMember);
router.delete('/:communityId/members/:memberUserId', requireAuth, removeCommunityMember);

module.exports = router;
