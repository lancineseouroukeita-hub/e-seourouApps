const { verifyToken } = require('../utils/jwt');
const prisma = require('../config/prisma');

/**
 * Middleware Express : vérifie le header "Authorization: Bearer <token>"
 * et attache l'utilisateur décodé à req.user.
 *
 * Vérifie aussi que l'appareil (Paramètres → Appareils connectés, voir
 * schema.prisma Device) n'a pas été déconnecté à distance depuis un autre
 * appareil — sans ça, un token révoqué resterait valable jusqu'à son
 * expiration naturelle (jusqu'à 7 jours, voir JWT_EXPIRES_IN), ce qui rendrait
 * la déconnexion à distance inutile. Un token émis AVANT l'ajout de cette
 * fonctionnalité n'a pas de deviceId : on le laisse passer sans vérification
 * plutôt que de déconnecter d'un coup tout le monde au déploiement.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const decoded = verifyToken(token);
    if (decoded.deviceId) {
      const device = await prisma.device.findUnique({ where: { id: decoded.deviceId } });
      if (!device || device.userId !== decoded.id || device.revokedAt) {
        return res.status(401).json({ error: 'Cet appareil a été déconnecté à distance.' });
      }
      // Pas d'attente bloquante sur la réponse : juste pour que "dernière
      // activité" reste à jour dans la liste des appareils connectés.
      prisma.device.update({ where: { id: device.id }, data: { lastActiveAt: new Date() } }).catch(() => {});
    }
    req.user = decoded; // { id, phone, name, deviceId? }
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

/**
 * À utiliser après requireAuth. Le token ne contient pas le statut
 * administrateur (voir utils/jwt.js) : on revérifie toujours en base plutôt
 * que de lui faire confiance, pour qu'un token émis avant le retrait d'un
 * accès administrateur ne le conserve pas jusqu'à son expiration (jusqu'à 7
 * jours, voir JWT_EXPIRES_IN).
 */
async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isAdmin: true } });
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Accès administrateur requis.' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth, requireAdmin };
