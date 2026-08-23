// Regroupe les réactions emoji brutes d'un message (une ligne par utilisateur
// ayant réagi) en une liste compacte par emoji : [{ emoji, userIds }].
// Le client déduit lui-même "ma propre réaction" en vérifiant si son id
// figure dans userIds, plutôt que de recevoir un booléen déjà calculé — même
// logique que pour lastReadAt/participants ailleurs dans l'API.
function aggregateReactions(reactions) {
  const byEmoji = new Map();
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji).push(r.userId);
  }
  return Array.from(byEmoji.entries()).map(([emoji, userIds]) => ({ emoji, userIds }));
}

module.exports = { aggregateReactions };
