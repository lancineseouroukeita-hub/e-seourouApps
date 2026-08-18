const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');

function serializeConversation(conv, currentUserId) {
  return {
    id: conv.id,
    isGroup: conv.isGroup,
    name: conv.name,
    createdAt: conv.createdAt,
    participants: conv.participants.map((p) => toPublicUser(p.user)),
    lastMessage: conv.messages && conv.messages[0]
      ? {
        id: conv.messages[0].id,
        content: conv.messages[0].content,
        senderId: conv.messages[0].senderId,
        createdAt: conv.messages[0].createdAt,
      }
      : null,
  };
}

// Liste les conversations auxquelles l'utilisateur courant participe.
async function listConversations(req, res) {
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { userId: req.user.id } } },
    include: {
      participants: { include: { user: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({
    conversations: conversations.map((c) => serializeConversation(c, req.user.id)),
  });
}

// Crée une conversation 1-à-1 ou de groupe. body: { participantIds: string[], isGroup?, name? }
async function createConversation(req, res) {
  const { participantIds, isGroup, name } = req.body;

  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'participantIds doit être un tableau non vide.' });
  }

  const allParticipantIds = Array.from(new Set([req.user.id, ...participantIds]));
  const isGroupConversation = Boolean(isGroup) || allParticipantIds.length > 2;

  // Pour une conversation 1-à-1, on réutilise une conversation existante si elle existe déjà.
  if (!isGroupConversation) {
    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        participants: { every: { userId: { in: allParticipantIds } } },
        AND: allParticipantIds.map((id) => ({ participants: { some: { userId: id } } })),
      },
      include: { participants: { include: { user: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (existing && existing.participants.length === allParticipantIds.length) {
      return res.status(200).json({ conversation: serializeConversation(existing, req.user.id) });
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      isGroup: isGroupConversation,
      name: isGroupConversation ? (name || 'Nouveau groupe') : null,
      participants: {
        create: allParticipantIds.map((userId) => ({ userId })),
      },
    },
    include: { participants: { include: { user: true } }, messages: true },
  });

  return res.status(201).json({ conversation: serializeConversation(conversation, req.user.id) });
}

// Historique des messages d'une conversation.
async function getMessages(req, res) {
  const { conversationId } = req.params;

  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: req.user.id } },
  });
  if (!participant) {
    return res.status(403).json({ error: 'Vous ne participez pas à cette conversation.' });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    include: { sender: true },
  });

  return res.json({
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      content: m.content,
      createdAt: m.createdAt,
      sender: toPublicUser(m.sender),
    })),
  });
}

module.exports = { listConversations, createConversation, getMessages };
