// Envoi de SMS, avec dégradation gracieuse si aucun fournisseur n'est
// configuré — même idée que utils/push.js pour les notifications push : en
// l'absence des variables d'environnement nécessaires, on n'échoue jamais,
// on affiche juste le code en clair dans les logs serveur (utile en
// développement, et tant qu'aucun compte Twilio n'a été branché en prod).
//
// Pour activer l'envoi réel de SMS via Twilio, définir sur Render :
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// (un compte Twilio d'essai suffit pour tester ; TWILIO_FROM_NUMBER est le
// numéro Twilio expéditeur, au format international, ex: "+15551234567").
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

const configured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

if (!configured) {
  console.warn(
    'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER absents des variables ' +
    'd\'environnement : l\'envoi de SMS est simulé (code affiché dans les logs serveur ' +
    'au lieu d\'être réellement envoyé). L\'app fonctionne normalement, il suffit ' +
    'd\'ajouter ces variables plus tard pour activer l\'envoi réel via Twilio.'
  );
}

// Envoie un SMS à un numéro donné. Ne lève jamais d'exception vers l'appelant
// (même logique que sendPushToUser) : un problème d'envoi de SMS ne doit
// jamais faire échouer le flux d'inscription/mot de passe oublié qui l'a
// déclenché — l'appelant (utils/otp.js) gère lui-même le cas "code non
// délivrable" en le journalisant, l'utilisateur peut toujours redemander un code.
async function sendSms(phone, message) {
  if (!configured) {
    console.log(`[SMS simulé] à ${phone} : ${message}`);
    return { ok: true, simulated: true };
  }
  try {
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({ To: phone, From: TWILIO_FROM_NUMBER, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Envoi SMS Twilio échoué :', res.status, text);
      return { ok: false, simulated: false };
    }
    return { ok: true, simulated: false };
  } catch (err) {
    console.error('Envoi SMS Twilio erreur :', err);
    return { ok: false, simulated: false };
  }
}

module.exports = { sendSms, isSmsConfigured: () => configured };
