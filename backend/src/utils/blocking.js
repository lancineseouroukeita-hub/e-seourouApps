const prisma = require('../config/prisma');

// Vrai si l'un des deux utilisateurs a bloqué l'autre (dans n'importe quel
// sens) : sert à interdire l'envoi de messages et le démarrage d'appels entre
// deux personnes dès que l'une des deux a bloqué l'autre, même si ce n'est
// pas réciproque (Paramètres → Confidentialité → Utilisateurs bloqués).
async function isBlockedBetween(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const row = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { blockerId: userIdA, blockedId: userIdB },
        { blockerId: userIdB, blockedId: userIdA },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

module.exports = { isBlockedBetween };

