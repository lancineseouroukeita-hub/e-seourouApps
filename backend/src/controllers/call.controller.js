const prisma = require('../config/prisma');

// Serveurs STUN/TURN pour les appels WebRTC (voix/vidéo). Les identifiants TURN
// (relais utilisé quand la connexion directe entre deux réseaux différents
// échoue — ex: un participant en wifi, l'autre en 4G) étaient auparavant écrits
// en clair dans le code de la page, visibles par n'importe qui ouvrant les
// outils développeur du navigateur, même sans être connecté. Ici, la config
// est lue depuis des variables d'environnement côté serveur (modifiables sur
// Render sans nouveau déploiement) et n'est renvoyée qu'aux utilisateurs déjà
// authentifiés (voir requireAuth sur la route) — les valeurs par défaut
// reprennent l'ancien compte Metered.ca gratuit tel quel, pour ne rien casser
// tant que personne n'a renseigné de nouvelles variables sur Render.
function getIceServers(req, res) {
  const turnUsername = process.env.TURN_USERNAME || '1c16e03d8537142774d692d5';
  const turnCredential = process.env.TURN_CREDENTIAL || 'hhD7ibTLehv5CtkY';
  const turnHost = process.env.TURN_HOST || 'global.relay.metered.ca';

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: `turn:${turnHost}:80`, username: turnUsername, credential: turnCredential },
    { urls: `turn:${turnHost}:80?transport=tcp`, username: turnUsername, credential: turnCredential },
    { urls: `turn:${turnHost}:443`, username: turnUsername, credential: turnCredential },
    { urls: `turns:${turnHost}:443?transport=tcp`, username: turnUsername, credential: turnCredential },
  ];

  return res.json({ iceServers });
}

// Historique des appels (onglet "Appels", comme WhatsApp) : tous les appels des
// conversations auxquelles je participe, avec pour chacun mon statut (décroché
// / manqué), le sens (sortant / entrant) et la durée si j'ai réellement rejoint
// l'appel. Un appel "manqué" est un appel dont j'ai fait partie de la
// conversation visée mais que je n'ai jamais rejoint (pas de CallParticipant
// pour moi) — c'est le seul signal disponible côté serveur, il n'y a pas de
// notion explicite "d'appelant" stockée sur le modèle Call lui-même.
async function listCalls(req, res) {
  const userId = req.user.id;

  const participations = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  const conversationIds = participations.map((p) => p.conversationId);
  if (conversationIds.length === 0) return res.json({ calls: [] });

  const calls = await prisma.call.findMany({
    where: { conversationId: { in: conversationIds } },
    include: {
      conversation: { include: { participants: { include: { user: true } } } },
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
    },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });

  const result = calls.map((call) => {
    const myPart = call.participants.find((p) => p.userId === userId);
    const otherConvParticipants = call.conversation.participants.filter((p) => p.userId !== userId);
    const other = otherConvParticipants[0]; // suffisant pour une conversation 1-à-1
    const firstJoiner = call.participants[0]; // premier arrivé dans l'appel = considéré comme l'appelant
    const missed = !myPart;
    const outgoing = Boolean(firstJoiner && firstJoiner.userId === userId);

    let duration = null;
    if (myPart && myPart.leftAt) {
      duration = Math.max(0, Math.round((new Date(myPart.leftAt) - new Date(myPart.joinedAt)) / 1000));
    }

    return {
      id: call.id,
      conversationId: call.conversationId,
      type: call.type,
      isGroup: call.conversation.isGroup,
      label: call.conversation.isGroup ? (call.conversation.name || 'Groupe') : (other ? other.user.name : '—'),
      avatarUrl: !call.conversation.isGroup && other ? other.user.avatarUrl : null,
      startedAt: call.startedAt,
      missed,
      outgoing,
      duration,
    };
  });

  return res.json({ calls: result });
}

module.exports = { listCalls, getIceServers };
