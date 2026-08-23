const prisma = require('../config/prisma');
const { roomName } = require('./chat');
const { sendPushToUser } = require('../utils/push');
const { isBlockedBetween } = require('../utils/blocking');

// État en mémoire des appels en cours : callId -> Map<socketId, { userId, name }>
// Pour un déploiement multi-instances, il faudrait déplacer cet état dans Redis (ou utiliser
// l'adaptateur Redis de Socket.io) afin que tous les serveurs partagent la même vue des appels.
const activeCalls = new Map();

// Délai de grâce avant de considérer qu'un participant a VRAIMENT quitté un
// appel après une déconnexion involontaire du socket (coupure réseau, passage
// wifi/4G, application mise en arrière-plan...). Sans ce délai, la moindre
// coupure de quelques secondes raccrochait l'appel des DEUX côtés — alors que
// le socket se reconnecte de lui-même (Socket.io) et que le client rejoint
// alors automatiquement la même room d'appel (voir "rejoinCallAfterReconnect"
// côté frontend). Un raccrochage volontaire (bouton "Raccrocher", évènement
// "call:leave") reste lui immédiat, jamais retardé.
const DISCONNECT_GRACE_MS = 20000;
// clé "callId:userId" -> { timer, socketId } : permet d'annuler le départ
// différé si le même utilisateur rejoint le même appel avant l'expiration.
const pendingDisconnectLeaves = new Map();

function getOrCreateCallRoom(callId) {
  if (!activeCalls.has(callId)) activeCalls.set(callId, new Map());
  return activeCalls.get(callId);
}

// Vrai si cet utilisateur est déjà présent (room Socket.io active) dans un
// appel — quel qu'il soit — au moment où on vérifie. Utilisé uniquement pour
// détecter "occupé" avant de créer un NOUVEL appel 1-à-1 (voir call:join) :
// à ce stade, aucune room n'existe encore pour cet appel, donc parcourir
// activeCalls entièrement ne peut pas se confondre avec lui-même.
function isUserInAnotherCall(targetUserId) {
  for (const room of activeCalls.values()) {
    for (const info of room.values()) {
      if (info.userId === targetUserId) return true;
    }
  }
  return false;
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

      // Appel 1-à-1 avec un utilisateur bloqué (par moi ou par lui) : on
      // interdit de démarrer/rejoindre l'appel dans les deux sens.
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { select: { userId: true, user: { select: { name: true } } } } },
      });
      if (!conv) return callback && callback({ error: 'Conversation introuvable.' });
      const other = !conv.isGroup ? conv.participants.find((p) => p.userId !== userId) : null;
      if (other && await isBlockedBetween(userId, other.userId)) {
        return callback && callback({ error: 'Impossible d\'appeler : utilisateur bloqué.' });
      }

      let call = callId ? await prisma.call.findUnique({ where: { id: callId } }) : null;

      if (!call) {
        // Appel 1-à-1 : si le correspondant est déjà dans un AUTRE appel actif
        // (occupé ailleurs), on ne le fait pas sonner dans le vide — on le dit
        // tout de suite à l'appelant (voir "busy" côté client : tonalité
        // "occupé" au lieu de la sonnerie de retour d'appel), comme un vrai
        // réseau téléphonique. Ne s'applique qu'à la CRÉATION d'un nouvel
        // appel 1-à-1 : pour un appel de groupe, un seul membre occupé ne doit
        // pas empêcher les autres de répondre.
        if (other && isUserInAnotherCall(other.userId)) {
          return callback && callback({
            error: `${other.user.name} est déjà en communication.`,
            busy: true,
          });
        }
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

      // Si ce même utilisateur avait un départ différé en attente pour cet
      // appel (déconnexion récente, voir plus bas), on l'annule : il est
      // revenu à temps, personne d'autre n'a besoin d'être prévenu qu'il est
      // parti puisque, de leur point de vue, il n'est jamais vraiment sorti
      // de la room d'appel.
      const pendingKey = call.id + ':' + userId;
      const pending = pendingDisconnectLeaves.get(pendingKey);
      if (pending) {
        clearTimeout(pending.timer);
        pendingDisconnectLeaves.delete(pendingKey);
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
    // L'émetteur ET le destinataire doivent être des participants ACTIFS de
    // CET appel précis (présents dans activeCalls, rempli par call:join) :
    // sans cette vérification, n'importe quel utilisateur authentifié
    // pouvait relayer du signal WebRTC vers un socketId aperçu ailleurs (ex:
    // via l'évènement "call:user-joined", diffusé à toute la room de la
    // conversation) sans avoir lui-même rejoint l'appel — usurpation possible.
    const room = activeCalls.get(callId);
    if (!room || !room.has(socket.id) || !room.has(to)) return;
    io.to(to).emit('call:signal', {
      callId,
      from: socket.id,
      userId,
      signal,
    });
  });

  // "Battement de cœur" léger entre participants d'un appel : sert de filet de
  // sécurité côté client si jamais "call:leave"/"call:user-left" ne suffit pas
  // à fermer l'appel de l'autre côté (cause encore incertaine dans certains cas
  // observés en conditions réelles) — le client considère un correspondant
  // parti s'il ne reçoit plus son battement pendant quelques secondes, qu'il
  // ait ou non reçu le signal explicite.
  socket.on('call:ping', ({ callId }) => {
    if (!callId) return;
    socket.to(callRoomName(callId)).emit('call:peer-ping', { callId, socketId: socket.id });
  });

  // Refus explicite d'un appel entrant (bouton "Refuser") : contrairement à
  // call:leave, on n'a jamais rejoint la room de cet appel (pas de
  // room.set/socket.join pour quelqu'un qui refuse), donc call:user-left ne
  // serait jamais émis pour ce cas — sans ce signal dédié, l'appelant
  // entendrait sa sonnerie de retour d'appel indéfiniment au lieu de savoir
  // que l'appel a été refusé.
  socket.on('call:decline', ({ callId }) => {
    if (!callId) return;
    io.to(callRoomName(callId)).emit('call:declined', { callId, userId });
  });

  // Raccrochage volontaire (bouton "Raccrocher") : immédiat, jamais retardé.
  socket.on('call:leave', async ({ callId }) => {
    try {
      await leaveCall(io, socket, callId);
    } catch (err) {
      console.error('call:leave error:', err);
    }
  });

  // Déconnexion du socket (perte réseau, mise en arrière-plan, fermeture de
  // l'onglet...) : on ne sait pas encore si c'est involontaire et temporaire
  // (l'utilisateur va probablement se reconnecter tout seul, voir Socket.io
  // côté client) ou définitif — on retire donc ce socket de la room tout de
  // suite (il ne peut plus rien recevoir), mais on NE prévient PAS encore les
  // autres participants : on attend le délai de grâce (voir scheduleDisconnectLeave).
  socket.on('disconnect', () => {
    for (const callId of activeCalls.keys()) {
      const room = activeCalls.get(callId);
      if (room.has(socket.id)) {
        const info = room.get(socket.id);
        room.delete(socket.id);
        scheduleDisconnectLeave(io, callId, socket.user.id, socket.id);
      }
    }
  });
}

// Programme le départ différé d'un utilisateur déconnecté d'un appel : s'il
// ne revient pas (nouveau socket qui rejoint le même appel, voir call:join)
// avant l'expiration du délai de grâce, on applique alors les mêmes
// conséquences qu'un raccrochage volontaire (accusé de départ + fin d'appel
// si plus personne d'autre n'est présent).
function scheduleDisconnectLeave(io, callId, userId, socketId) {
  const key = callId + ':' + userId;
  const existing = pendingDisconnectLeaves.get(key);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pendingDisconnectLeaves.delete(key);
    finalizeLeave(io, callId, userId, socketId).catch((err) => {
      console.error('finalizeLeave error:', err);
    });
  }, DISCONNECT_GRACE_MS);

  pendingDisconnectLeaves.set(key, { timer, socketId });
}

// Raccrochage volontaire (bouton "Raccrocher", "call:leave") : effet immédiat.
async function leaveCall(io, socket, callId) {
  const room = activeCalls.get(callId);
  if (!room || !room.has(socket.id)) return;

  room.delete(socket.id);
  socket.leave(callRoomName(callId));
  await finalizeLeave(io, callId, socket.user.id, socket.id);
}

// Applique réellement les conséquences d'un départ (volontaire ou après
// expiration du délai de grâce d'une déconnexion) : accusé "call:user-left"
// envoyé aux autres participants encore présents, marquage en base, et fin de
// l'appel si plus personne n'y participe.
async function finalizeLeave(io, callId, userId, socketId) {
  const room = activeCalls.get(callId);
  io.to(callRoomName(callId)).emit('call:user-left', { callId, socketId });

  try {
    await prisma.callParticipant.updateMany({
      where: { callId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });

    if (!room || room.size === 0) {
      activeCalls.delete(callId);
      const call = await prisma.call.update({
        where: { id: callId },
        data: { status: 'ended', endedAt: new Date() },
      }).catch(() => null); // ignore si l'appel a déjà été marqué comme terminé

      // Prévient TOUS les participants de la conversation (pas seulement ceux
      // déjà dans la "room" de l'appel WebRTC) : indispensable quand l'appelant
      // raccroche avant que quiconque ait décroché — sinon la personne appelée
      // n'a jamais rejoint la room de l'appel, ne reçoit donc pas "call:user-left"
      // ci-dessus, et son téléphone continue de sonner indéfiniment.
      if (call) {
        io.to(roomName(call.conversationId)).emit('call:cancelled', { callId });
      }
    }
  } catch (err) {
    console.error('finalizeLeave cleanup error:', err);
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

