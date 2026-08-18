const express = require('express');
const {
  listConversations,
  createConversation,
  getMessages,
} = require('../controllers/conversation.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, listConversations);
router.post('/', requireAuth, createConversation);
router.get('/:conversationId/messages', requireAuth, getMessages);

module.exports = router;
