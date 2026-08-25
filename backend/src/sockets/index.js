const { verifyToken } = require('../utils/jwt');
const { registerChatHandlers } = require('./chat');
const { registerSignalingHandlers } = require('./signaling');
const { registerLiveHandlers } = require('./live');
const { userRoomName } = require('../utils/rooms');
const { markOnline, markOffline } = require('../utils/presence');
const prisma = require('../config/prisma');

/**
 * Configure le serveur Socket.io : authentification par JWT lors du handshake,
 * puis enregistrement des gestionnaires de messagerie et de signalisation WebRTC.
 */
function setupSocket(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentification requise.'));

    try {
      const decoded = verifyToken(token);
      // Même vérification que middleware/auth.js côté REST : un appareil
      // déconnecté à distance (Paramètres → Appareils connectés) ne doit pas
      // continuer à recevoir les messages en temps réel. Token sans deviceId
      // (émis avant cette fonctionnalité) : laissé passer, voir le même
      // commentaire dans middleware/auth.js.
      if (decoded.deviceId) {
        const device = await prisma.device.findUnique({ where: { id: decoded.deviceId } });
        if (!device || device.userId !== decoded.id || device.revokedAt) {
          return next(new Error('Cet appareil a été déconnecté à distance.'));
        }
      }
      socket.user = decoded; // { id, phone, name, deviceId? }
      return next();
    } catch (err) {
      return next(new Error('Token invalide ou expiré.'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connecté: ${socket.id} (utilisateur ${socket.user.id})`);

    // Room personnelle (indépendante des conversations) : permet aux contrôleurs
    // REST de notifier directement CET utilisateur — sur tous ses appareils/onglets
    // ouverts à la fois — sans connaître à l'avance la liste de ses conversations.
    // Utilisé par ex. quand il est ajouté à une nouvelle discussion/communauté.
    socket.join(userRoomName(socket.user.id));

    // Enregistrés tout de suite, EN PREMIER et de façon synchrone (avant tout
    // travail asynchrone comme la présence ci-dessous) : un événement émis
    // par le client juste après la connexion (ex: rejoindre une conversation,
    // signalisation d'appel) ne doit jamais risquer d'arriver AVANT que le
    // bon gestionnaire ne soit attaché — Socket.io ne met pas en attente un
    // événement sans écouteur, il serait simplement perdu. Avant ce
    // correctif, ces trois lignes arrivaient APRÈS un aller-retour base de
    // données (await hidesLastSeen()), ce qui retardait d'autant leur mise en
    // place et rendait la connexion moins fiable ("parfois ça marche du
    // premier coup, parfois il faut réessayer une action juste après avoir
    // ouvert l'appli").
    registerChatHandlers(io, socket);
    registerSignalingHandlers(io, socket);
    registerLiveHandlers(io, socket);

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
    // Fait en tâche de fond (IIFE async, jamais attendue) : ça ne doit
    // retarder ni les gestionnaires ci-dessus ni quoi que ce soit d'autre
    // pour ce socket — un léger délai sur la diffusion "en ligne" aux autres
    // ne se voit pas, un délai sur les propres actions de la personne, si.
    (async () => {
      if (markOnline(socket.user.id) && !(await hidesLastSeen())) {
        io.emit('presence:update', { userId: socket.user.id, online: true });
      }
    })().catch((err) => console.error('Diffusion de présence (connexion) échouée :', err));

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
