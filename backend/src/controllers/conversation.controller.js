const prisma = require('../config/prisma');
const { toPublicUser } = require('./auth.controller');
const { userRoomName } = require('../utils/rooms');
const { isOnline } = require('../utils/presence');
const { aggregateReactions } = require('../utils/reactions');
const { isBlockedBetween } = require('../utils/blocking');
const { replyPreview: buildReplyPreview } = require('../utils/replyPreview');

// Même aperçu de message cité qu'en temps réel (sockets/chat.js) : centralisé
// dans utils/replyPreview.js pour que les deux affichages restent identiques.
function replyPreview(replyTo) {
  return buildReplyPreview(replyTo, previewLabel);
}

// Notifie en temps réel (via Socket.io) les participants d'une conversation
// qu'ils viennent d'en rejoindre une, en excluant l'utilisateur à l'origine
// de l'action (il connaît déjà la conversation, c'est lui qui vient de la
// créer/qui a créé le groupe). Sans ça, les autres participants ne verraient
// cette conversation qu'au prochain rechargement de l'application.
function notifyConversationCreated(req, conversation, excludeUserId) {
  const io = req.app.get('io');
  if (!io) return; // pas de socket configuré (ex: tests) : pas grave, juste pas de temps réel
  const serialized = serializeConversation(conversation);
  conversation.participants
    .map((p) => p.userId || (p.user && p.user.id))
    .filter((id) => id && id !== excludeUserId)
    .forEach((id) => io.to(userRoomName(id)).emit('conversation:new', { conversation: serialized }));
}

// Texte d'aperçu affiché dans la liste des conversations pour un message avec
// pièce jointe (pas de texte, ou en complément d'une légende).
function previewLabel(message) {
  if (message.deleted) return '🚫 Message supprimé';
  if (message.type === 'image') return '📷 Photo';
  if (message.type === 'voice') return '🎤 Message vocal';
  if (message.type === 'file') return '📎 ' + (message.attachmentName || 'Fichier');
  return message.content;
}

function serializeConversation(conv, currentUserId) {
  // Réglages propres à MOI (sourdine/archivage, voir ConversationParticipant) :
  // recherchés dans la liste déjà chargée des participants plutôt que par une
  // requête séparée, pour ne pas alourdir listConversations.
  const mine = currentUserId && conv.participants
    ? conv.participants.find((p) => (p.userId || (p.user && p.user.id)) === currentUserId)
    : null;
  return {
    id: conv.id,
    isGroup: conv.isGroup,
    name: conv.name,
    createdAt: conv.createdAt,
    muted: Boolean(mine && mine.muted),
    archived: Boolean(mine && mine.archived),
    locked: Boolean(mine && mine.locked),
    // On inclut lastReadAt (par participant) en plus des infos publiques de
    // l'utilisateur : c'est ce qui permet au client d'afficher une coche simple
    // (envoyé) ou double (lu par le destinataire), comme WhatsApp/iMessage.
    // Comme dans listUsers : un participant qui masque sa dernière connexion
    // n'expose jamais online/lastSeenAt aux autres.
    participants: conv.participants.map((p) => {
      const pub = toPublicUser(p.user);
      if (p.user.hideLastSeen) pub.lastSeenAt = null;
      return Object.assign(pub, { lastReadAt: p.lastReadAt, online: p.user.hideLastSeen ? false : isOnline(p.user.id) });
    }),
    lastMessage: conv.messages && conv.messages[0]
      ? {
        id: conv.messages[0].id,
        content: previewLabel(conv.messages[0]),
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

  // Comme pour l'envoi de message/les appels (voir sockets/chat.js,
  // signaling.js) : impossible de démarrer une conversation 1-à-1 avec
  // quelqu'un qui a bloqué (ou qui est bloqué par) l'utilisateur courant.
  // Sans ça, la conversation apparaissait quand même côté client, et seul
  // l'envoi du premier message échouait ensuite — incohérent.
  if (!isGroupConversation) {
    const otherId = allParticipantIds.find((id) => id !== req.user.id);
    if (otherId && await isBlockedBetween(req.user.id, otherId)) {
      return res.status(403).json({ error: 'Impossible de démarrer cette conversation : utilisateur bloqué.' });
    }
  }

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

  notifyConversationCreated(req, conversation, req.user.id);

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
    include: {
      sender: true,
      replyTo: { include: { sender: true } },
      reactions: true,
    },
  });

  return res.json({
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      content: m.content,
      type: m.type,
      deleted: m.deleted,
      attachment: (m.type !== 'text' && !m.deleted) ? {
        data: m.attachmentData,
        mime: m.attachmentMime,
        name: m.attachmentName,
        size: m.attachmentSize,
        duration: m.duration,
      } : null,
      createdAt: m.createdAt,
      sender: toPublicUser(m.sender),
      replyTo: replyPreview(m.replyTo),
      reactions: aggregateReactions(m.reactions),
      edited: m.edited,
      editedAt: m.editedAt,
      pinned: m.pinned,
      pinnedAt: m.pinnedAt,
      forwarded: m.forwarded,
    })),
  });
}

// Met à jour la sourdine/l'archivage/le verrouillage de CETTE conversation
// pour l'utilisateur connecté (propre à chaque participant, voir
// ConversationParticipant.muted/archived/locked).
async function updateMyConversationSettings(req, res) {
  const { conversationId } = req.params;
  const { muted, archived, locked } = req.body || {};
  if (typeof muted !== 'boolean' && typeof archived !== 'boolean' && typeof locked !== 'boolean') {
    return res.status(400).json({ error: 'muted, archived et/ou locked (booléen) sont requis.' });
  }
  try {
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: req.user.id } },
    });
    if (!participant) return res.status(404).json({ error: 'Conversation introuvable.' });

    const data = {};
    if (typeof muted === 'boolean') data.muted = muted;
    if (typeof archived === 'boolean') data.archived = archived;
    if (typeof locked === 'boolean') data.locked = locked;

    const updated = await prisma.conversationParticipant.update({
      where: { id: participant.id },
      data,
    });
    return res.json({ ok: true, muted: updated.muted, archived: updated.archived, locked: updated.locked });
  } catch (err) {
    console.error('updateMyConversationSettings error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la mise à jour de la discussion.' });
  }
}

// Supprime une conversation de ma liste (Paramètres → Utilisateurs / liste des
// discussions) : on retire seulement ma propre participation ("suppression
// pour moi", comme WhatsApp), l'autre personne garde son historique de son
// côté. Si plus personne ne participe à la conversation, elle est
// définitivement effacée (avec ses messages, grâce à onDelete: Cascade).
async function leaveConversation(req, res) {
  const { conversationId } = req.params;
  try {
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: req.user.id } },
    });
    if (!participant) return res.status(404).json({ error: 'Conversation introuvable.' });

    await prisma.conversationParticipant.delete({ where: { id: participant.id } });

    const remaining = await prisma.conversationParticipant.count({ where: { conversationId } });
    if (remaining === 0) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => null);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('leaveConversation error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression de la conversation.' });
  }
}

module.exports = {
  listConversations,
  createConversation,
  getMessages,
  previewLabel,
  leaveConversation,
  serializeConversation,
  notifyConversationCreated,
  updateMyConversationSettings,
};

