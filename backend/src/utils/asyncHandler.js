// Enveloppe un contrôleur Express async pour transmettre toute erreur/rejet
// au middleware d'erreur via next(err), au lieu de laisser une promesse
// rejetée non gérée remonter jusqu'à Node — ce qui, dans une route Express
// classique (sans ce filet), fait planter TOUT le process (donc déconnecte
// tous les utilisateurs) au lieu de simplement faire échouer cette requête.
// À utiliser en enveloppant chaque contrôleur au moment de le brancher sur
// une route : router.get('/', requireAuth, asyncHandler(monControleur)).
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
