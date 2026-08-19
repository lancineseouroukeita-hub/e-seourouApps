const prisma = require('../config/prisma');
const { roomName } = require('./chat');
const { sendPushToUser } = require('../utils/push');

// État en mémoire des appels en cours : callId -> Map<socketId, { userId, name }>
// Pour un déploiement multi-instances, il faudrait déplacer cet état dans Redis (ou utiliser
// l'adaptateur Redis de Socket.io) afin que tous les serveurs partagent la même vue des appels.
const activeCalls = new Map();

function getOrCreateCallRoom(callId) {
  if (!activeCalls.has(callId)) activeCalls.set(callId, new Map());
  return activeCalls.get(callId);
}

/**
 * Signalisation WebRTC en topologie "mesh" : chaque participant établit une connexion
 * peer-to-peer directe avec chacun des autres participants. Adapté aux appels 1-à-1 et
 * aux petits groupes (jusqu'à ~4-6 personnes) ; au-delà, le nombre de connexions croît en
 * O(n²) et il devient préférable de passer par un serveur média (SFU) comme mediasoup ou LiveKit.
 */
function registerSignalingHandlers(io, socket) {
  const userId = socket.user.id;
  const userName = socket.user.name;

  // Démarre ou rejoint un appel pour une conversation donnée.
  // type: "video" | "audio"
  socket.on('call:join', async ({ conversationId, callId, type }, callback) => {
    try {
      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!participant) {
        return callback && callback({ error: 'Vous ne participez pas à cette conversation.' });
      }

      let call = callId ? await prisma.call.findUnique({ where: { id: callId } }) : null;

      if (!call) {
        call = await prisma.call.create({
          data: { conversationId, type: type || 'video' },
        });

        // Prévient les autres participants de la conversation qu'un appel démarre,
        // pour qu'ils puissent afficher une notification d'appel entrant.
        socket.to(roomName(conversationId)).emit('call:incoming', {
          callId: call.id,
          conversationId,
          type: call.type,
          from: { id: userId, name: userName },
        });

        // Notification push : utile si l'app n'est pas ouverte au moment de
        // l'appel (le "call:incoming" ci-dessus ne touche que les sockets connectés).
        notifyIncomingCall(conversationId, userId, userName, call.type).catch((err) => {
          console.error('push notify (call) error:', err);
        });
      }

      await prisma.callParticipant.create({ data: { callId: call.id, userId } });

      const room = getOrCreateCallRoom(call.id);
      const existingPeers = Array.from(room.entries()).map(([socketId, info]) => ({
        socketId,
        userId: info.userId,
        name: info.name,
      }));

      room.set(socket.id, { userId, name: userName });
      socket.join(callRoomName(call.id));

      // Le nouveau participant reçoit la liste des pairs déjà présents pour initier les offres WebRTC.
      callback && callback({ callId: call.id, type: call.type, peers: existingPeers });

      // Les participants déjà présents sont informés de l'arrivée du nouveau pair.
      socket.to(callRoomName(call.id)).emit('call:user-joined', {
        callId: call.id,
        socketId: socket.id,
        userId,
        name: userName,
      });
    } catch (err) {
      console.error('call:join error:', err);
      callback && callback({ error: 'Erreur serveur lors de la connexion à l\'appel.' });
    }
  });

  // Relaie les messages de signalisation WebRTC (SDP offer/answer, ICE candidates)
  // d'un pair précis à un autre. Le serveur ne comprend pas le contenu, il relaie simplement.
  socket.on('call:signal', ({ callId, to, signal }) => {
    if (!callId || !to || !signal) return;
    io.to(to).emit('call:signal', {
      callId,
      from: socket.id,
      userId,
      signal,
    });
  });

  socket.on('call:leave', async ({ callId }) => {
    await leaveCall(io, socket, callId);
  });

  socket.on('disconnect', async () => {
    for (const callId of activeCalls.keys()) {
      if (activeCalls.get(callId).has(socket.id)) {
        await leaveCall(io, socket, callId);
      }
    }
  });
}

async function leaveCall(io, socket, callId) {
  const room = activeCalls.get(callId);
  if (!room || !room.has(socket.id)) return;

  room.delete(socket.id);
  socket.leave(callRoomName(callId));
  socket.to(callRoomName(callId)).emit('call:user-left', { callId, socketId: socket.id });

  try {
    await prisma.callParticipant.updateMany({
      where: { callId, userId: socket.user.id, leftAt: null },
      data: { leftAt: new Date() },
    });

    if (room.size === 0) {
      activeCalls.delete(callId);
      await prisma.call.update({
        where: { id: callId },
        data: { status: 'ended', endedAt: new Date() },
      }).catch(() => {}); // ignore si l'appel a déjà été marqué comme terminé
    }
  } catch (err) {
    console.error('leaveCall cleanup error:', err);
  }
}

async function notifyIncomingCall(conversationId, callerId, callerName, type) {
  const others = await prisma.conversationParticipant.findMany({
    where: { conversationId, userId: { not: callerId } },
    select: { userId: true },
  });
  const label = type === 'video' ? 'Appel vidéo entrant' : 'Appel audio entrant';
  await Promise.all(others.map((p) => sendPushToUser(p.userId, {
    title: label,
    body: callerName,
    tag: 'call:' + conversationId,
    requireInteraction: true,
    data: { type: 'call', conversationId },
  })));
}

function callRoomName(callId) {
  return `call:${callId}`;
}

module.exports = { registerSignalingHandlers };
