const prisma = require('../config/prisma');

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

module.exports = { listCalls };
