// Désigne les numéros de téléphone qui doivent obtenir automatiquement le
// statut "administrateur" (voir User.isAdmin dans schema.prisma) dès qu'ils
// se connectent ou s'inscrivent — même principe de "dégradation élégante" que
// utils/sms.js : rien de configuré, aucun administrateur ; on ajoute un ou
// plusieurs numéros dans ADMIN_PHONES sur Render (Environment) sans avoir à
// toucher au code ni à la base directement.
//
// Format : liste de numéros séparés par des virgules, ex.
//   ADMIN_PHONES=+224621000000,+224700000001
// Les espaces/tirets sont tolérés (mêmes règles de normalisation qu'à
// l'inscription/connexion, voir auth.controller.js normalizePhone).

function normalize(raw) {
  return String(raw || '').trim().replace(/[\s-]/g, '');
}

function getAdminPhoneSet() {
  const raw = process.env.ADMIN_PHONES || '';
  return new Set(
    raw
      .split(',')
      .map((p) => normalize(p))
      .filter(Boolean)
  );
}

function isAdminPhone(phone) {
  if (!phone) return false;
  return getAdminPhoneSet().has(normalize(phone));
}

module.exports = { isAdminPhone };
