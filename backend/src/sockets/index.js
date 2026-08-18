const { verifyToken } = require('../utils/jwt');
const { registerChatHandlers } = require('./chat');
const { registerSignalingHandlers } = require('./signaling');

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
      socket.user = decoded; // { id, email, name }
      return next();
    } catch (err) {
      return next(new Error('Token invalide ou expiré.'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connecté: ${socket.id} (utilisateur ${socket.user.id})`);

    registerChatHandlers(io, socket);
    registerSignalingHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(`Socket déconnecté: ${socket.id} (${reason})`);
    });
  });
}

module.exports = { setupSocket };
