const { verifyToken } = require('../utils/jwt');
const prisma = require('../config/prisma');

/**
 * Middleware Express : vérifie le header "Authorization: Bearer <token>"
 * et attache l'utilisateur décodé à req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, phone, name }
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
