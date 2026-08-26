const prisma = require('../config/prisma');

// État en mémoire des directs "LIVE" en cours : liveId -> { hostSocketId,
// hostUserId, hostName, viewers: Map<socketId, { userId, name }> }.
// Même limite que activeCalls (voir sockets/signaling.js) pour un déploiement
// multi-instances : à déplacer dans Redis si un jour plusieurs serveurs
// tournent en parallèle (pas le cas ici, un seul service Render).
const activeLives = new Map();

// Delai de grace avant de considerer qu'un DIFFUSEUR a vraiment quitte son
// direct apres une deconnexion involontaire du socket (coupure reseau,
// changement wifi/4G, application mise en arriere-plan...) - meme principe
// que DISCONNECT_GRACE_MS pour les appels (voir sockets/signaling.js).
// Avant ce correctif (build v40, signale par Lancine), la moindre coupure de
// quelques secondes cote diffuseur terminait le direct DEFINITIVEMENT pour
// tout le monde, alors que Socket.io se reconnecte souvent tout seul en
// quelques secondes. Un arret volontaire ("Terminer le direct", live:end)
// reste lui immediat, jamais retarde.
const RECONNECT_GRACE_MS = 20000;
// liveId -> { timer } : permet d'annuler la fin differee si le diffuseur
// revient (voir live:resume) avant l'expiration du delai de grace.
const pendingHostDisconnects = new Map();

function liveRoomName(liveId) {
  return `live:${liveId}`;
}

/**
 * Signalisation WebRTC d'un direct "LIVE" : topologie "étoile" centrée sur le
 * diffuseur — chaque spectateur établit sa PROPRE connexion peer-to-peer avec
 * le diffuseur (jamais avec les autres spectateurs, contrairement à un appel
 * de groupe en mesh, voir sockets/signaling.js) : le diffuseur crée donc une
 * RTCPeerConnection par spectateur, côté client (voir videos.html,
 * startGoingLive). Le serveur ne fait ici que relayer les messages SDP/ICE
 * entre les deux bons sockets et suivre qui regarde quoi, exactement comme
 * call:signal pour les appels.
 */
function registerLiveHandlers(io, socket) {
  const userId = socket.user.id;
  const userName = socket.user.name;

  // Démarre un nouveau direct — contrairement à call:join, jamais de
  // "rejoindre un direct existant" côté diffuseur : un compte ne peut
  // diffuser qu'UN direct à la fois (voir la clôture de tout direct restant
  // de cet utilisateur ci-dessous, filet de sécurité si un ancien direct
  // n'a jamais été fermé proprement, ex: crash de l'app).
  socket.on('live:start', async ({ title } = {}, callback) => {
    try {
      // Filet de sécurité : si un précédent direct de ce même compte est
      // resté "actif" en base (ex: fermeture brutale de l'app sans passer
      // par live:end/disconnect), on le clôture avant d'en ouvrir un nouveau
      // plutôt que de laisser deux directs "en cours" pour la même personne.
      await prisma.liveSession.updateMany({
        where: { hostId: userId, endedAt: null },
        data: { endedAt: new Date() },
      });

      const trimmedTitle = typeof title === 'string' ? title.trim().slice(0, 100) : '';
      const session = await prisma.liveSession.create({
        data: { hostId: userId, title: trimmedTitle || null },
      });

      activeLives.set(session.id, {
        hostSocketId: socket.id,
        hostUserId: userId,
        hostName: userName,
        viewers: new Map(),
      });
      socket.join(liveRoomName(session.id));

      callback && callback({ liveId: session.id, startedAt: session.startedAt });

      // Prévient tout le monde (pas seulement les personnes déjà sur l'onglet
      // LIVE) qu'un nouveau direct est disponible — le client se contente de
      // rafraîchir sa liste (voir videos.html, loadLiveList) plutôt que de
      // recevoir directement les infos ici, pour rester simple et toujours
      // cohérent avec la base (pas de risque de payload obsolète).
      io.emit('live:list-changed');
    } catch (err) {
      console.error('live:start error:', err);
      callback && callback({ error: 'Impossible de démarrer le direct.' });
    }
  });

  // Un spectateur rejoint un direct déjà en cours.
  socket.on('live:join', async ({ liveId } = {}, callback) => {
    try {
      if (!liveId) return callback && callback({ error: 'Direct invalide.' });
      const entry = activeLives.get(liveId);
      if (!entry) return callback && callback({ error: 'Ce direct est terminé.' });

      entry.viewers.set(socket.id, { userId, name: userName });
      socket.join(liveRoomName(liveId));

      const count = entry.viewers.size;
      prisma.liveSession.update({ where: { id: liveId }, data: { viewerCount: count } }).catch((err) => {
        console.error('live:join viewerCount update error:', err);
      });
      io.to(liveRoomName(liveId)).emit('live:viewer-count', { liveId, count });

      // Le diffuseur reçoit l'arrivée de ce spectateur pour lui créer une
      // RTCPeerConnection dédiée et lui envoyer une offre (voir
      // startGoingLive côté client) — c'est TOUJOURS le diffuseur qui
      // initie l'offre, jamais le spectateur.
      io.to(entry.hostSocketId).emit('live:viewer-joined', {
        liveId,
        socketId: socket.id,
        userId,
        name: userName,
      });

      callback && callback({ ok: true, hostSocketId: entry.hostSocketId });
    } catch (err) {
      console.error('live:join error:', err);
      callback && callback({ error: 'Erreur serveur lors de la connexion au direct.' });
    }
  });

  // Relaie les messages de signalisation WebRTC (offre/réponse SDP, candidats
  // ICE) entre le diffuseur et UN spectateur précis — le serveur ne comprend
  // pas le contenu, il relaie simplement, comme call:signal.
  // Le diffuseur revient apres une coupure reseau (voir "disconnect" plus
  // bas et scheduleHostDisconnectLeave) : si son direct est encore dans son
  // delai de grace, on le "ranime" sur ce nouveau socket (son ancien socket
  // Socket.io n'existe plus apres une reconnexion) plutot que d'obliger a
  // redemarrer un direct tout neuf - les spectateurs encore presents sont
  // prevenus pour renegocier une connexion WebRTC fraiche avec ce nouveau
  // socket (voir videos.html, live:host-back).
  socket.on('live:resume', ({ liveId } = {}, callback) => {
    try {
      const entry = activeLives.get(liveId);
      if (!entry || entry.hostUserId !== userId) {
        return callback && callback({ error: 'Ce direct est termine.' });
      }
      const pending = pendingHostDisconnects.get(liveId);
      if (pending) { clearTimeout(pending.timer); pendingHostDisconnects.delete(liveId); }
      entry.hostSocketId = socket.id;
      socket.join(liveRoomName(liveId));
      callback && callback({ ok: true, viewerCount: entry.viewers.size });
      io.to(liveRoomName(liveId)).emit('live:host-back', { liveId });
    } catch (err) {
      console.error('live:resume error:', err);
      callback && callback({ error: 'Erreur serveur lors de la reprise du direct.' });
    }
  });

  socket.on('live:signal', ({ liveId, to, signal } = {}) => {
    if (!liveId || !to || !signal) return;
    const entry = activeLives.get(liveId);
    if (!entry) return;
    // L'émetteur ET le destinataire doivent être soit le diffuseur, soit un
    // spectateur ENREGISTRÉ de CE direct précis — sans cette vérification,
    // n'importe quel utilisateur authentifié pourrait relayer du signal
    // WebRTC vers un socketId aperçu ailleurs (même raisonnement que
    // call:signal, voir sockets/signaling.js).
    const isParticipant = (id) => id === entry.hostSocketId || entry.viewers.has(id);
    if (!isParticipant(socket.id) || !isParticipant(to)) return;
    io.to(to).emit('live:signal', { liveId, from: socket.id, userId, signal });
  });

  // Départ volontaire d'un spectateur (ferme l'écran du direct) — le
  // diffuseur, lui, utilise live:end (voir plus bas), jamais live:leave.
  socket.on('live:leave', ({ liveId } = {}) => {
    if (!liveId) return;
    removeViewer(io, liveId, socket.id);
  });

  // Fin volontaire d'un direct (bouton "Terminer le direct", diffuseur
  // uniquement — vérifié via hostSocketId, pas juste "c'est mon liveId").
  socket.on('live:end', async ({ liveId } = {}) => {
    if (!liveId) return;
    const entry = activeLives.get(liveId);
    if (!entry || entry.hostSocketId !== socket.id) return;
    await endLive(io, liveId);
  });

  // Déconnexion du socket : contrairement à un appel (délai de grâce avant de
  // considérer un départ comme définitif, voir sockets/signaling.js), un
  // direct s'arrête immédiatement si c'est le DIFFUSEUR qui se déconnecte —
  // pas de round de rattrapage possible pour une diffusion en direct (si la
  // personne revient, elle redémarre simplement un nouveau direct). Un
  // spectateur qui se déconnecte, lui, est juste retiré normalement.
  socket.on('disconnect', () => {
    for (const [liveId, entry] of activeLives.entries()) {
      if (entry.hostSocketId === socket.id) {
        scheduleHostDisconnectLeave(io, liveId);
      } else if (entry.viewers.has(socket.id)) {
        removeViewer(io, liveId, socket.id);
      }
    }
  });
}

// Programme la fin differee d'un direct dont le diffuseur vient de se
// deconnecter (coupure reseau probable) : les spectateurs sont prevenus tout
// de suite d'une reconnexion en cours (pas d'un direct termine, voir
// live:host-connection-lost) pour que leur ecran affiche un etat clair
// plutot qu'une image figee sans explication. Si le diffuseur revient a
// temps (live:resume ci-dessus), le direct continue normalement ; sinon, il
// se termine reellement a l'expiration du delai, exactement comme avant ce
// correctif.
function scheduleHostDisconnectLeave(io, liveId) {
  const existing = pendingHostDisconnects.get(liveId);
  if (existing) clearTimeout(existing.timer);

  io.to(liveRoomName(liveId)).emit('live:host-connection-lost', { liveId });

  const timer = setTimeout(() => {
    pendingHostDisconnects.delete(liveId);
    endLive(io, liveId).catch((err) => console.error('endLive (grace expiree) error:', err));
  }, RECONNECT_GRACE_MS);

  pendingHostDisconnects.set(liveId, { timer });
}

function removeViewer(io, liveId, socketId) {
  const entry = activeLives.get(liveId);
  if (!entry || !entry.viewers.has(socketId)) return;
  entry.viewers.delete(socketId);
  const count = entry.viewers.size;
  prisma.liveSession.update({ where: { id: liveId }, data: { viewerCount: count } }).catch((err) => {
    console.error('removeViewer viewerCount update error:', err);
  });
  io.to(liveRoomName(liveId)).emit('live:viewer-count', { liveId, count });
  // Le diffuseur ferme sa RTCPeerConnection dédiée à ce spectateur (voir
  // startGoingLive côté client).
  io.to(entry.hostSocketId).emit('live:viewer-left', { liveId, socketId });
}

async function endLive(io, liveId) {
  const pending = pendingHostDisconnects.get(liveId);
  if (pending) { clearTimeout(pending.timer); pendingHostDisconnects.delete(liveId); }
  const entry = activeLives.get(liveId);
  if (!entry) return;
  activeLives.delete(liveId);
  io.to(liveRoomName(liveId)).emit('live:ended', { liveId });
  try {
    await prisma.liveSession.update({ where: { id: liveId }, data: { endedAt: new Date() } });
  } catch (err) {
    // Déjà clôturé (ex: filet de sécurité de live:start) — sans conséquence.
    console.error('endLive db update error:', err);
  }
  io.emit('live:list-changed');
}

module.exports = { registerLiveHandlers };
