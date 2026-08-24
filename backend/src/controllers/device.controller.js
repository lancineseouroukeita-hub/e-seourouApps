const prisma = require('../config/prisma');

// Sérialise un appareil pour le client (Paramètres → Appareils connectés).
// isCurrent : celui utilisé par la requête en cours — affiché en tête de
// liste avec un badge "Cet appareil", comme WhatsApp, plutôt que révocable.
function serializeDevice(device, currentDeviceId) {
  return {
    id: device.id,
    label: device.label,
    createdAt: device.createdAt,
    lastActiveAt: device.lastActiveAt,
    isCurrent: device.id === currentDeviceId,
  };
}

// Déconnecte immédiatement les sockets temps réel ouverts sur cet appareil
// (sinon il continuerait à recevoir messages/appels jusqu'à sa prochaine
// reconnexion, malgré la révocation — voir sockets/index.js qui bloque
// seulement les NOUVELLES connexions). Best-effort : l'absence d'objet io
// (ex. tests) ne doit pas faire échouer la révocation elle-même.
function disconnectDeviceSockets(req, deviceId) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.user && socket.user.deviceId === deviceId) {
        socket.disconnect(true);
      }
    }
  } catch (err) {
    console.error('disconnectDeviceSockets error:', err);
  }
}

// Liste les appareils actuellement connectés (non révoqués) de l'utilisateur
// courant, le plus récemment actif en premier — comme WhatsApp.
async function listDevices(req, res) {
  try {
    const devices = await prisma.device.findMany({
      where: { userId: req.user.id, revokedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
    return res.json({ devices: devices.map((d) => serializeDevice(d, req.user.deviceId)) });
  } catch (err) {
    console.error('listDevices error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement des appareils connectés.' });
  }
}

// Déconnecte à distance UN AUTRE appareil (jamais celui-ci : le bouton
// "Se déconnecter" habituel s'en charge déjà, et le révoquer ici couperait la
// requête en train de le faire, ce qui serait déroutant).
async function logoutDevice(req, res) {
  try {
    const { id } = req.params;
    if (id === req.user.deviceId) {
      return res.status(400).json({ error: 'Utilisez "Se déconnecter" pour cet appareil.' });
    }
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || device.userId !== req.user.id) {
      return res.status(404).json({ error: 'Appareil introuvable.' });
    }
    await prisma.device.update({ where: { id }, data: { revokedAt: new Date() } });
    disconnectDeviceSockets(req, id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('logoutDevice error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la déconnexion de cet appareil.' });
  }
}

// "Se déconnecter de tous les autres appareils" (bouton en tête de la liste,
// comme WhatsApp) : révoque tout sauf celui-ci en un seul appel.
async function logoutOtherDevices(req, res) {
  try {
    const others = await prisma.device.findMany({
      where: { userId: req.user.id, revokedAt: null, id: { not: req.user.deviceId } },
      select: { id: true },
    });
    await prisma.device.updateMany({
      where: { id: { in: others.map((d) => d.id) } },
      data: { revokedAt: new Date() },
    });
    others.forEach((d) => disconnectDeviceSockets(req, d.id));
    return res.json({ ok: true, count: others.length });
  } catch (err) {
    console.error('logoutOtherDevices error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la déconnexion des autres appareils.' });
  }
}

// Révoque l'appareil COURANT — appelé au clic sur "Se déconnecter" (voir
// index.html) en plus d'effacer le token côté client, pour que cet appareil
// disparaisse aussi de la liste vue depuis les autres appareils connectés.
// Idempotent et sans conséquence si deviceId est absent (token émis avant
// cette fonctionnalité) : on répond simplement { ok: true } dans ce cas.
async function logoutSelf(req, res) {
  try {
    if (!req.user.deviceId) return res.json({ ok: true });
    await prisma.device.update({
      where: { id: req.user.deviceId },
      data: { revokedAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('logoutSelf error:', err);
    // Le token va de toute façon être effacé côté client : pas la peine de
    // faire échouer la déconnexion pour autant si cet appel a un problème.
    return res.json({ ok: true });
  }
}

module.exports = { listDevices, logoutDevice, logoutOtherDevices, logoutSelf };
