// Retire les espaces/tirets/parenthèses/points pour que "+224 621 00 00 00",
// "+224-621-00-00-00" et "+224 (621) 00.00.00" soient reconnus comme le même
// numéro. Convertit aussi le préfixe international "00" en "+" (ex:
// "00224621000000" -> "+224621000000"), sinon ces deux écritures créeraient
// deux entrées distinctes pour le même numéro. Partagé entre
// auth.controller.js (inscription/connexion) et contact.controller.js
// (répertoire de contacts) pour que les mêmes règles s'appliquent partout.
function normalizePhone(raw) {
  let phone = String(raw || '').trim().replace(/[\s\-().]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  return phone;
}

// Numéro international ou local, chiffres uniquement (+ optionnel en tête).
const PHONE_REGEX = /^\+?[0-9]{6,15}$/;

module.exports = { normalizePhone, PHONE_REGEX };
