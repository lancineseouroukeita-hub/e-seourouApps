const prisma = require('../config/prisma');
const { toPublicUser } = require('../controllers/auth.controller');

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

  socket.on('message:send', async ({ conversationId, content }, callback) => {
    try {
      if (!conversationId || !content || !content.trim()) {
        return callback && callback({ error: 'conversationId et content sont requis.' });
      }

      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      const message = await prisma.message.create({
        data: { conversationId, senderId: userId, content: content.trim() },
        include: { sender: true },
      });

      const payload = {
        id: message.id,
        conversationId,
        content: message.content,
        createdAt: message.createdAt,
        sender: toPublicUser(message.sender),
      };

      io.to(roomName(conversationId)).emit('message:new', payload);
      callback && callback({ message: payload });
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
}

function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

module.exports = { registerChatHandlers, roomName };
