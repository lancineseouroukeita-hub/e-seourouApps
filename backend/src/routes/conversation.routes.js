const express = require('express');
const {
  listConversations,
  createConversation,
  getMessages,
  leaveConversation,
  updateMyConversationSettings,
  clearConversation,
} = require('../controllers/conversation.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, asyncHandler(listConversations));
router.post('/', requireAuth, asyncHandler(createConversation));
router.get('/:conversationId/messages', requireAuth, asyncHandler(getMessages));
router.delete('/:conversationId', requireAuth, asyncHandler(leaveConversation));
router.patch('/:conversationId/settings', requireAuth, asyncHandler(updateMyConversationSettings));
router.post('/:conversationId/clear', requireAuth, asyncHandler(clearConversation));

module.exports = router;
