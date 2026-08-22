const { verifyToken } = require('../utils/jwt');
const { registerChatHandlers } = require('./chat');
const { registerSignalingHandlers } = require('./signaling');
const { userRoomName } = require('../utils/rooms');
const { markOnline, markOffline } = require('../utils/presence');
const prisma = require('../config/prisma');

/**
 * Configure le serveur Socket.io : authentification par JWT lors du handshake,
 * puis enregistrement des gestionnaires de messagerie et de signalisation WebRTC.
 */
function setupSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentification requise.'));

    try {
      const decoded = verifyToken(token);
      socket.user = decoded; // { id, phone, name }
      return next();
    } catch (err) {
      return next(new Error('Token invalide ou expiré.'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`Socket connecté: ${socket.id} (utilisateur ${socket.user.id})`);

    // Room personnelle (indépendante des conversations) : permet aux contrôleurs
    // REST de notifier directement CET utilisateur — sur tous ses appareils/onglets
    // ouverts à la fois — sans connaître à l'avance la liste de ses conversations.
    // Utilisé par ex. quand il est ajouté à une nouvelle discussion/communauté.
    socket.join(userRoomName(socket.user.id));

    // Confidentialité "dernière connexion" (Paramètres) : si activée, on ne
    // diffuse JAMAIS le statut de cet utilisateur aux autres — ni maintenant,
    // ni à la déconnexion. Revérifié à chaque connexion/déconnexion (et pas
    // seulement mis en cache) car le réglage peut changer en cours de session.
    async function hidesLastSeen() {
      try {
        const dbUser = await prisma.user.findUnique({ where: { id: socket.user.id }, select: { hideLastSeen: true } });
        return Boolean(dbUser && dbUser.hideLastSeen);
      } catch (err) {
        console.error('Lecture de hideLastSeen échouée :', err);
        return false;
      }
    }

    // Présence ("En ligne" / "vu à ...", comme WhatsApp) : ne prévient TOUT LE
    // MONDE que si c'est vraiment le premier appareil/onglet de cet
    // utilisateur qui se connecte (il peut déjà être en ligne ailleurs).
    if (markOnline(socket.user.id) && !(await hidesLastSeen())) {
      io.emit('presence:update', { userId: socket.user.id, online: true });
    }

    registerChatHandlers(io, socket);
    registerSignalingHandlers(io, socket);

    socket.on('disconnect', async (reason) => {
      console.log(`Socket déconnecté: ${socket.id} (${reason})`);

      // Idem dans l'autre sens : ne prévient que si c'était son DERNIER
      // appareil/onglet connecté (sinon il reste en ligne via les autres).
      if (markOffline(socket.user.id)) {
        const lastSeenAt = new Date();
        try {
          await prisma.user.update({ where: { id: socket.user.id }, data: { lastSeenAt } });
        } catch (err) {
          console.error('Mise à jour de lastSeenAt échouée :', err);
        }
        if (!(await hidesLastSeen())) {
          io.emit('presence:update', { userId: socket.user.id, online: false, lastSeenAt });
        }
      }
    });
  });
}

module.exports = { setupSocket };
