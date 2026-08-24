// Étiquette lisible d'un appareil ("Chrome sur Windows", "Safari sur iPhone"…)
// dérivée du header User-Agent envoyé par le navigateur à la connexion/
// inscription — voir auth.controller.js (register/login) qui l'enregistre
// sur le Device créé, et Paramètres → Appareils connectés qui l'affiche.
// Pas de dépendance externe (ua-parser, etc.) : quelques motifs suffisent
// pour les cas réels de cette appli, pas besoin d'une détection exhaustive.
function describeDevice(userAgent) {
  const ua = userAgent || '';

  let os = 'un appareil inconnu';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Ordre important : Edge et Opera embarquent aussi "Chrome" dans leur UA,
  // et Chrome sur iOS embarque "Safari" — donc on teste les plus spécifiques
  // d'abord, exactement comme il faut le faire pour ne pas les confondre.
  let browser = 'Navigateur';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return `${browser} sur ${os}`;
}

module.exports = { describeDevice };
