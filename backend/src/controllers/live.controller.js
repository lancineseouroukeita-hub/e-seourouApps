const prisma = require('../config/prisma');

// GET /api/live — liste des directs EN COURS (endedAt: null), pour l'onglet
// "LIVE" (voir videos.html, loadLiveList). La création/fin d'un direct, elle,
// passe par Socket.io (voir sockets/live.js, live:start/live:end) plutôt que
// par une route REST — exactement comme call:join/call:leave pour les appels
// (voir sockets/signaling.js) : la signalisation temps réel a de toute façon
// besoin d'un socket connecté, autant y faire aussi vivre le cycle de vie du
// direct plutôt que de le répartir entre REST et Socket.io.
async function listLiveSessions(req, res) {
  const lives = await prisma.liveSession.findMany({
    where: { endedAt: null },
    include: { host: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { startedAt: 'desc' },
  });
  return res.json({ lives });
}

module.exports = { listLiveSessions };
