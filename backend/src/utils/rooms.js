// Noms des "rooms" Socket.io utilisés à plusieurs endroits (sockets ET
// contrôleurs REST) : centralisés ici pour éviter les dépendances circulaires
// entre les contrôleurs (auth.controller -> ... ) et les gestionnaires socket.

// Room d'une conversation : tous les participants connectés y reçoivent les
// nouveaux messages, accusés de lecture, etc.
function roomName(conversationId) {
  return `conversation:${conversationId}`;
}

// Room personnelle d'un utilisateur (tous ses appareils/onglets ouverts à la
// fois) : permet aux contrôleurs REST de le notifier directement (ex: ajouté à
// une nouvelle discussion/communauté) sans connaître à l'avance la liste des
// conversations dont il fait déjà partie.
function userRoomName(userId) {
  return `user:${userId}`;
}

module.exports = { roomName, userRoomName };
