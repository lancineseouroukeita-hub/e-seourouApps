// Retire les espaces/tirets/parenthèses/points pour que "+224 621 00 00 00",
// "+224-621-00-00-00" et "+224 (621) 00.00.00" soient reconnus comme le même
// numéro. Convertit aussi le préfixe international "00" en "+" (ex:
// "00224621000000" -> "+224621000000"), sinon ces deux écritures créeraient
// deux entrées distinctes pour le même numéro. Partagé entre
// auth.controller.js (inscription/connexion) et contact.controller.js
// (répertoire de contacts) pour que les mêmes règles s'appliquent partout.
//
// `defaultDial` (optionnel, ex: "+224") : si le numéro nettoyé n'a toujours
// pas d'indicatif ("+..."), on lui applique cet indicatif par défaut plutôt
// que de le laisser tel quel. Sert exclusivement à l'import de contacts (voir
// contact.controller.js) : le carnet d'adresses du téléphone contient très
// souvent des numéros enregistrés SANS indicatif ("622227616" plutôt que
// "+224622227616") alors que tous les comptes de l'application sont stockés
// avec indicatif complet (voir auth.controller.js / getFullPhone côté front)
// — sans ce complément, ces numéros locaux ne matcheraient jamais un compte
// existant. On ne l'utilise volontairement PAS pour l'inscription/connexion :
// là, le numéro vient toujours du sélecteur d'indicatif du formulaire, donc
// il est déjà complet.
function normalizePhone(raw, defaultDial) {
  let phone = String(raw || '').trim().replace(/[\s\-().]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (defaultDial && phone && !phone.startsWith('+')) {
    const dialDigits = defaultDial.slice(1); // "+224" -> "224"
    if (phone.startsWith(dialDigits)) {
      // Numéro déjà écrit avec l'indicatif mais sans le "+" (ex: quelqu'un a
      // tapé "224622227616") : on ajoute juste le "+", on ne le préfixe pas
      // une deuxième fois.
      phone = '+' + phone;
    } else {
      // Numéro purement local, sans aucun indicatif (cas le plus courant
      // dans un répertoire de téléphone). Retire un éventuel "0" de tête
      // (préfixe interurbain, ex: France "0621000000"), convention courante
      // quand un numéro est noté sans indicatif international.
      phone = defaultDial + phone.replace(/^0+/, '');
    }
  }
  return phone;
}

// Numéro international ou local, chiffres uniquement (+ optionnel en tête).
const PHONE_REGEX = /^\+?[0-9]{6,15}$/;

// Indicatifs téléphoniques internationaux connus (doit rester cohérent avec
// la liste COUNTRIES de backend/public/index.html), triés du plus long au
// plus court pour que le préfixe le plus SPÉCIFIQUE l'emporte (ex: "+1876"
// Jamaïque doit être reconnu avant le simple "+1" Amérique du Nord).
const DIAL_CODES = ['+1876','+1809','+1868','+1242','+1246','+224','+221','+225','+223','+226','+227','+228','+229','+222','+245','+220','+232','+231','+233','+234','+237','+235','+236','+241','+242','+243','+240','+239','+244','+260','+263','+258','+265','+264','+267','+266','+268','+261','+230','+248','+269','+253','+252','+251','+291','+211','+249','+254','+256','+255','+250','+257','+218','+216','+213','+212','+238','+352','+377','+353','+351','+358','+354','+420','+421','+359','+385','+386','+381','+387','+382','+389','+355','+383','+370','+371','+372','+380','+375','+373','+995','+374','+994','+357','+356','+376','+423','+378','+379','+502','+501','+504','+503','+505','+506','+507','+509','+593','+591','+598','+595','+592','+597','+594','+590','+596','+262','+689','+687','+850','+976','+886','+852','+853','+856','+855','+673','+670','+880','+977','+975','+960','+998','+993','+992','+996','+966','+971','+974','+973','+965','+968','+967','+962','+961','+963','+964','+972','+970','+679','+675','+685','+676','+678','+677','+27','+20','+33','+32','+41','+49','+44','+34','+39','+31','+43','+45','+46','+47','+48','+36','+40','+30','+90','+52','+53','+57','+58','+51','+56','+54','+55','+86','+81','+82','+84','+66','+95','+60','+65','+62','+63','+91','+92','+94','+93','+98','+61','+64','+7','+1'];

// Retrouve l'indicatif d'un numéro déjà complet (ex: "+224621000000" ->
// "+224"). Utilisé pour déterminer l'indicatif par défaut à appliquer aux
// contacts importés sans indicatif : on part du principe que quelqu'un qui
// enregistre un numéro local dans son téléphone sans indicatif l'a fait dans
// SON PROPRE pays — donc on réutilise l'indicatif de son propre compte
// (comme WhatsApp le fait via la carte SIM, que nous n'avons pas côté web).
function extractDialCode(fullPhone) {
  const phone = String(fullPhone || '');
  if (!phone.startsWith('+')) return null;
  return DIAL_CODES.find((d) => phone.startsWith(d)) || null;
}

module.exports = { normalizePhone, PHONE_REGEX, extractDialCode };
