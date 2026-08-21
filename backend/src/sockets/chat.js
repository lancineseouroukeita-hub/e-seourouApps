const prisma = require('../config/prisma');
const { toPublicUser } = require('../controllers/auth.controller');
const { previewLabel } = require('../controllers/conversation.controller');
const { sendPushToUser } = require('../utils/push');
const { isBlockedBetween } = require('../utils/blocking');
const { roomName } = require('../utils/rooms');
const { aggregateReactions } = require('../utils/reactions');
const { replyPreview: buildReplyPreview } = require('../utils/replyPreview');
const { MAX_ATTACHMENT_BASE64_LENGTH } = require('../utils/limits');

// Applique previewLabel (de conversation.controller.js) telle que définie ici,
// pour garder un affichage identique à celui de l'historique REST.
function replyPreview(replyTo) {
  return buildReplyPreview(replyTo, previewLabel);
}

// Longueur max du texte d'un message : rien ne la limitait côté serveur
// jusqu'ici (seule la taille des pièces jointes l'était), ce qui permettait
// d'envoyer plusieurs Mo de texte dans un seul message (jusqu'à la limite
// technique de maxHttpBufferSize de Socket.io). 20 000 caractères est déjà
// largement au-delà de tout message réel.
const MAX_MESSAGE_LENGTH = 20000;

/**
 * Attache les gestionnaires d'événements liés à la messagerie texte sur un socket déjà authentifié.
 * L'utilisateur rejoint automatiquement une "room" par conversation pour recevoir les nouveaux messages.
 */
function registerChatHandlers(io, socket) {
  const userId = socket.user.id;

  // Rejoint les rooms de toutes les conversations de l'utilisateur au moment de la connexion.
  (async () => {
    const participations = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    participations.forEach((p) => socket.join(roomName(p.conversationId)));
  })();

  // Permet de rejoindre la room d'une conversation nouvellement créée sans reconnecter le socket.
  socket.on('conversation:join', ({ conversationId }) => {
    if (conversationId) socket.join(roomName(conversationId));
  });

  socket.on('message:send', async ({ conversationId, content, attachment, replyToId }, callback) => {
    try {
      const trimmedContent = (content || '').trim();
      const hasAttachment = attachment && attachment.data;

      if (!conversationId || (!trimmedContent && !hasAttachment)) {
        return callback && callback({ error: 'conversationId et un contenu (texte ou pièce jointe) sont requis.' });
      }
      if (trimmedContent.length > MAX_MESSAGE_LENGTH) {
        return callback && callback({ error: 'Message trop long (20 000 caractères maximum).' });
      }

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      // Discussion 1-à-1 avec un utilisateur bloqué (par moi ou par lui) : on
      // bloque l'envoi dans les deux sens (Paramètres → Confidentialité).
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { select: { userId: true } } },
      });
      if (!conv) return callback && callback({ error: 'Conversation introuvable.' });
      if (!conv.isGroup) {
        const other = conv.participants.find((p) => p.userId !== userId);
        if (other && await isBlockedBetween(userId, other.userId)) {
          return callback && callback({ error: 'Impossible d\'envoyer ce message : utilisateur bloqué.' });
        }
      }

      // Groupe d'annonces d'une Communauté : seuls les admins de la communauté
      // peuvent y écrire (comme le groupe d'annonces des Communautés WhatsApp).
      if (conv.isAnnouncement && conv.communityId) {
        const membership = await prisma.communityMember.findUnique({
          where: { communityId_userId: { communityId: conv.communityId, userId } },
        });
        if (!membership || membership.role !== 'admin') {
          return callback && callback({ error: 'Seuls les admins de la communauté peuvent écrire dans ce groupe d\'annonces.' });
        }
      }

      // Réponse citée (comme WhatsApp) : on vérifie que le message cité existe
      // bien et appartient à la même conversation, sinon on l'ignore silencieusement
      // plutôt que de faire échouer tout l'envoi pour une histoire de citation.
      let validReplyToId = null;
      if (replyToId) {
        const original = await prisma.message.findUnique({ where: { id: replyToId } });
        if (original && original.conversationId === conversationId) {
          validReplyToId = original.id;
        }
      }

      let data = {
        conversationId,
        senderId: userId,
        content: trimmedContent,
        replyToId: validReplyToId,
      };

      if (hasAttachment) {
        // Garde-fou côté serveur : même si le client limite déjà la taille des
        // fichiers, on revérifie ici (le champ "data" est la chaîne base64).
        if (attachment.data.length > MAX_ATTACHMENT_BASE64_LENGTH) {
          return callback && callback({ error: 'Fichier trop volumineux (5 Mo maximum).' });
        }
        const type = ['image', 'voice', 'file'].includes(attachment.type) ? attachment.type : 'file';
        data = {
          ...data,
          type,
          attachmentData: attachment.data,
          attachmentMime: attachment.mime || 'application/octet-stream',
          attachmentName: attachment.name || null,
          attachmentSize: Number.isFinite(attachment.size) ? attachment.size : null,
          duration: Number.isFinite(attachment.duration) ? attachment.duration : null,
        };
      }

      const message = await prisma.message.create({
        data,
        include: { sender: true, replyTo: { include: { sender: true } } },
      });

      const payload = {
        id: message.id,
        conversationId,
        content: message.content,
        type: message.type,
        deleted: false,
        attachment: hasAttachment ? {
          data: message.attachmentData,
          mime: message.attachmentMime,
          name: message.attachmentName,
          size: message.attachmentSize,
          duration: message.duration,
        } : null,
        createdAt: message.createdAt,
        sender: toPublicUser(message.sender),
        replyTo: replyPreview(message.replyTo),
        reactions: [],
      };

      io.to(roomName(conversationId)).emit('message:new', payload);
      callback && callback({ message: payload });

      // Notification push : prévient les autres participants même si l'app est
      // fermée (le socket ci-dessus ne touche que ceux qui ont l'app ouverte).
      // Ne doit jamais faire échouer l'envoi du message si ça plante.
      notifyNewMessage(conversationId, userId, message).catch((err) => {
        console.error('push notify (message) error:', err);
      });
    } catch (err) {
      console.error('message:send error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'envoi du message.' });
    }
  });

  // Réaction emoji sur un message (comme WhatsApp) : appuyer à nouveau sur la
  // même réaction la retire (toggle), en poser une autre remplace la précédente
  // (une seule réaction par utilisateur et par message, cf. @@unique en base).
  socket.on('message:react', async ({ messageId, emoji }, callback) => {
    try {
      if (!messageId || !emoji || typeof emoji !== 'string' || emoji.length > 8) {
        return callback && callback({ error: 'messageId et emoji (valide) sont requis.' });
      }

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      // Un message supprimé (douce ou définitive) n'a plus rien à afficher : pas
      // de raison d'accumuler des réactions sur une bulle "Message supprimé".
      if (message.deleted) return callback && callback({ error: 'Impossible de réagir à un message supprimé.' });

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: message.conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      const conv = await prisma.conversation.findUnique({
        where: { id: message.conversationId },
        include: { participants: { select: { userId: true } } },
      });
      // Conversation déjà supprimée entre-temps (cas limite rare) : même garde
      // que message:send, pour éviter un plantage sur "conv.isGroup" si conv est null.
      if (!conv) return callback && callback({ error: 'Conversation introuvable.' });
      if (!conv.isGroup) {
        const other = conv.participants.find((p) => p.userId !== userId);
        if (other && await isBlockedBetween(userId, other.userId)) {
          return callback && callback({ error: 'Impossible de réagir : utilisateur bloqué.' });
        }
      }

      const existing = await prisma.messageReaction.findUnique({
        where: { messageId_userId: { messageId, userId } },
      });

      if (existing && existing.emoji === emoji) {
        await prisma.messageReaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.messageReaction.upsert({
          where: { messageId_userId: { messageId, userId } },
          update: { emoji },
          create: { messageId, userId, emoji },
        });
      }

      const reactions = await prisma.messageReaction.findMany({ where: { messageId } });
      const aggregated = aggregateReactions(reactions);

      io.to(roomName(message.conversationId)).emit('message:reaction', {
        conversationId: message.conversationId,
        messageId,
        reactions: aggregated,
      });
      callback && callback({ ok: true, reactions: aggregated });
    } catch (err) {
      console.error('message:react error:', err);
      callback && callback({ error: 'Erreur serveur lors de la réaction au message.' });
    }
  });

  socket.on('typing', ({ conversationId, isTyping }) => {
    if (!conversationId) return;
    socket.to(roomName(conversationId)).emit('typing', {
      conversationId,
      userId,
      isTyping: Boolean(isTyping),
    });
  });

  // Suppression d'un message : seul son auteur peut le faire. On garde la ligne
  // en base (suppression "douce") mais on efface le contenu/la pièce jointe, et
  // on prévient tout le monde dans la conversation pour que l'affichage se
  // remplace par "Message supprimé" en direct, des deux côtés.
  socket.on('message:delete', async ({ messageId }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez supprimer que vos propres messages.' });
      }

      await prisma.message.update({
        where: { id: messageId },
        data: {
          deleted: true,
          content: '',
          attachmentData: null,
          attachmentMime: null,
          attachmentName: null,
          attachmentSize: null,
          duration: null,
        },
      });

      io.to(roomName(message.conversationId)).emit('message:deleted', {
        conversationId: message.conversationId,
        messageId,
      });
      callback && callback({ ok: true });
    } catch (err) {
      console.error('message:delete error:', err);
      callback && callback({ error: 'Erreur serveur lors de la suppression du message.' });
    }
  });

  // Effacement définitif de la trace "Message supprimé" : contrairement à
  // message:delete (suppression "douce", qui garde la ligne pour l'aperçu de
  // la conversation), ici on supprime réellement la ligne en base. La bulle
  // "🚫 Message supprimé" disparaît alors complètement de la conversation,
  // pour tout le monde, y compris après rechargement de l'historique.
  // Uniquement possible sur un message déjà passé par message:delete, et
  // uniquement par son auteur.
  socket.on('message:erase', async ({ messageId }, callback) => {
    try {
      if (!messageId) return callback && callback({ error: 'messageId requis.' });

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message) return callback && callback({ error: 'Message introuvable.' });
      if (message.senderId !== userId) {
        return callback && callback({ error: 'Vous ne pouvez effacer que vos propres messages.' });
      }
      if (!message.deleted) {
        return callback && callback({ error: 'Supprimez d\'abord ce message avant de l\'effacer définitivement.' });
      }

      await prisma.message.delete({ where: { id: messageId } });

      io.to(roomName(message.conversationId)).emit('message:erased', {
        conversationId: message.conversationId,
        messageId,
      });
      callback && callback({ ok: true });
    } catch (err) {
      console.error('message:erase error:', err);
      callback && callback({ error: 'Erreur serveur lors de l\'effacement du message.' });
    }
  });

  // Marque la conversation comme lue par l'utilisateur courant à cet instant.
  // Sert à afficher les doubles coches (✓✓) sur les messages envoyés par les
  // autres participants dès qu'ils ont ouvert la conversation (comme WhatsApp).
  socket.on('conversation:read', async ({ conversationId }) => {
    if (!conversationId) return;
    try {
      const readAt = new Date();
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId },
        data: { lastReadAt: readAt },
      });
      socket.to(roomName(conversationId)).emit('conversation:read-receipt', {
        conversationId,
        userId,
        readAt,
      });
    } catch (err) {
      console.error('conversation:read error:', err);
    }
  });
}

// Envoie une notification push à tous les autres participants de la conversation
// (le service worker décide lui-même de l'afficher ou non si l'app est déjà au premier plan).
async function notifyNewMessage(conversationId, senderId, message) {
  const [sender, others] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId } }),
    prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: senderId } },
      select: { userId: true },
    }),
  ]);
  if (!sender || others.length === 0) return;

  const body = previewLabel(message);
  await Promise.all(others.map((p) => sendPushToUser(p.userId, {
    title: sender.name,
    body,
    tag: 'conversation:' + conversationId,
    data: { type: 'message', conversationId },
  })));
}

module.exports = { registerChatHandlers, roomName };
