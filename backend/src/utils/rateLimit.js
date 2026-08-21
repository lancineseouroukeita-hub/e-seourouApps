// Limiteur de débit minimal, en mémoire (même principe que utils/presence.js :
// suffisant pour l'instance unique actuelle sur Render, pas prévu pour
// plusieurs instances sans Redis). Sert à freiner le brute-force sur
// /api/auth/login et /api/auth/register, qui n'avaient jusqu'ici aucune
// protection : sans ça, un script pouvait tester des mots de passe en boucle
// sans aucune limite serveur.
const WINDOW_MS = 15 * 60 * 1000; // fenêtre glissante de 15 minutes
const MAX_ATTEMPTS = 20; // largement suffisant pour un usage normal, même avec quelques fautes de frappe

// clé (IP) -> { count, windowStart }
const attempts = new Map();

// Nettoyage périodique pour ne pas laisser grossir la Map indéfiniment avec
// des IP qui ne reviennent jamais.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.windowStart > WINDOW_MS) attempts.delete(key);
  }
}, WINDOW_MS).unref();

function clientKey(req) {
  // req.ip respecte déjà "trust proxy" si configuré (utile derrière le proxy de Render).
  return req.ip || 'inconnu';
}

function authRateLimit(req, res, next) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }
  return next();
}

module.exports = { authRateLimit };
