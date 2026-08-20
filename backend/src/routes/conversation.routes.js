const express = require('express');
const {
  listConversations,
  createConversation,
  getMessages,
  leaveConversation,
} = require('../controllers/conversation.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listConversations);
router.post('/', requireAuth, createConversation);
router.get('/:conversationId/messages', requireAuth, getMessages);
router.delete('/:conversationId', requireAuth, leaveConversation);

module.exports = router;

