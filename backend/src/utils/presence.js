// Présence en ligne ("En ligne" / "vu à ...", comme WhatsApp) : état purement
// en mémoire, PAS persisté en base (seul le dernier "lastSeenAt" l'est, sur le
// modèle User, au moment où le dernier socket d'un utilisateur se déconnecte).
// Un même utilisateur peut avoir plusieurs sockets ouverts à la fois (plusieurs
// onglets/appareils) : on ne le considère "hors ligne" que lorsque AUCUN de
// ses sockets n'est plus connecté.
//
// Comme pour l'état des appels en cours (voir sockets/signaling.js), passer à
// plusieurs instances du serveur nécessiterait de partager cet état via Redis.
const onlineCounts = new Map(); // userId -> nombre de sockets actifs

// Enregistre un socket supplémentaire pour cet utilisateur. Renvoie true s'il
// vient de passer de "hors ligne" à "en ligne" (premier socket).
function markOnline(userId) {
  const count = (onlineCounts.get(userId) || 0) + 1;
  onlineCounts.set(userId, count);
  return count === 1;
}

// Retire un socket pour cet utilisateur. Renvoie true s'il vient de passer de
// "en ligne" à "hors ligne" (plus aucun socket actif).
function markOffline(userId) {
  const count = (onlineCounts.get(userId) || 1) - 1;
  if (count <= 0) {
    onlineCounts.delete(userId);
    return true;
  }
  onlineCounts.set(userId, count);
  return false;
}

function isOnline(userId) {
  return onlineCounts.has(userId);
}

module.exports = { markOnline, markOffline, isOnline };
