const { verifyToken } = require('../utils/jwt');

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

module.exports = { requireAuth };
