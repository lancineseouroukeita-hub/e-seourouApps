const prisma = require('../config/prisma');
const { toPublicUser } = require('../controllers/auth.controller');
const { previewLabel } = require('../controllers/conversation.controller');
const { sendPushToUser } = require('../utils/push');

// Taille max d'un fichier joint (avant encodage) : 5 Mo. Une fois encodé en
// base64, une chaîne grossit d'environ 33% (4 caractères pour 3 octets), d'où
// cette marge lors de la vérification côté serveur.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

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

  socket.on('message:send', async ({ conversationId, content, attachment }, callback) => {
    try {
      const trimmedContent = (content || '').trim();
      const hasAttachment = attachment && attachment.data;

      if (!conversationId || (!trimmedContent && !hasAttachment)) {
        return callback && callback({ error: 'conversationId et un contenu (texte ou pièce jointe) sont requis.' });
      }

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      let data = {
        conversationId,
        senderId: userId,
        content: trimmedContent,
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
        include: { sender: true },
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

function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

module.exports = { registerChatHandlers, roomName };
