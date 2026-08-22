// Envoi de SMS, avec dégradation gracieuse si aucun fournisseur n'est
// configuré — même idée que utils/push.js pour les notifications push : en
// l'absence des variables d'environnement nécessaires, on n'échoue jamais,
// on affiche juste le code en clair dans les logs serveur (utile en
// développement, et tant qu'aucun fournisseur n'a été branché en prod).
//
// Deux fournisseurs possibles, le premier configuré étant utilisé en priorité :
//
//  1) Orange (API "SMS Guinea Conakry" / Africa & Middle East) : nettement
//     moins cher pour les numéros guinéens (à partir de ~150 GNF/SMS avec un
//     petit forfait), payable via crédit Orange / Orange Money — pas besoin
//     de carte bancaire internationale. Pour l'activer sur Render :
//       ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET, ORANGE_SENDER_ADDRESS
//     (Client ID/secret récupérés dans la console developer.orange.com,
//     section "MyApps" après création d'une application sur l'API SMS ;
//     ORANGE_SENDER_ADDRESS est le numéro expéditeur au format international,
//     ex: "+224621000000" — celui assigné par Orange, ou le short code une
//     fois un forfait acheté).
//
//  2) Twilio : nécessite une carte bancaire et coûte plus cher pour la Guinée
//     (~0,28$/SMS), mais fonctionne dans le monde entier sans configuration
//     supplémentaire. Variables : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//     TWILIO_FROM_NUMBER.
//
// Important (Orange) : le format exact de cette API (endpoint OneAPI
// "smsmessaging", jeton OAuth v3) suit la documentation publique et stable
// d'Orange Developer, valable pour tous les pays qu'elle couvre — mais elle
// n'a pas pu être testée en conditions réelles avant qu'un compte développeur
// existe. Si le premier envoi échoue, vérifier dans les logs serveur le
// message renvoyé par l'API (souvent explicite : jeton refusé, numéro
// expéditeur invalide, forfait épuisé, etc.) et ajuster au besoin.
const ORANGE_CLIENT_ID = process.env.ORANGE_CLIENT_ID;
const ORANGE_CLIENT_SECRET = process.env.ORANGE_CLIENT_SECRET;
const ORANGE_SENDER_ADDRESS = process.env.ORANGE_SENDER_ADDRESS;
const orangeConfigured = Boolean(ORANGE_CLIENT_ID && ORANGE_CLIENT_SECRET && ORANGE_SENDER_ADDRESS);

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const twilioConfigured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

const configured = orangeConfigured || twilioConfigured;

if (!configured) {
  console.warn(
    'Aucun fournisseur SMS configuré (ni ORANGE_CLIENT_ID/ORANGE_CLIENT_SECRET/' +
    'ORANGE_SENDER_ADDRESS, ni TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER) : ' +
    'l\'envoi de SMS est simulé (code affiché dans les logs serveur au lieu ' +
    'd\'être réellement envoyé). L\'app fonctionne normalement, il suffit ' +
    'd\'ajouter ces variables plus tard pour activer l\'envoi réel.'
  );
} else if (orangeConfigured) {
  console.log('Fournisseur SMS actif : Orange.');
} else {
  console.log('Fournisseur SMS actif : Twilio.');
}

// ---------- Orange ----------

// Le jeton OAuth Orange expire après 1h : on le garde en mémoire et on ne le
// renouvelle que lorsqu'il approche de son expiration, plutôt que d'en
// redemander un à chaque SMS (voir doc Orange Developer, "getting-started").
let orangeTokenCache = null; // { token, expiresAt }

async function getOrangeToken() {
  if (orangeTokenCache && orangeTokenCache.expiresAt > Date.now() + 5000) {
    return orangeTokenCache.token;
  }
  const credentials = Buffer.from(`${ORANGE_CLIENT_ID}:${ORANGE_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.orange.com/oauth/v3/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jeton Orange refusé (${res.status}) : ${text}`);
  }
  const data = await res.json();
  orangeTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return orangeTokenCache.token;
}

// L'API Orange attend les numéros au format "tel:+224621000000".
function toTelUri(phone) {
  return phone.startsWith('tel:') ? phone : `tel:${phone}`;
}

async function sendSmsViaOrange(phone, message) {
  const token = await getOrangeToken();
  const senderAddress = toTelUri(ORANGE_SENDER_ADDRESS);
  const url = `https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(senderAddress)}/requests`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      outboundSMSMessageRequest: {
        address: [toTelUri(phone)],
        senderAddress,
        outboundSMSTextMessage: { message },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Envoi SMS Orange échoué :', res.status, text);
    return { ok: false, simulated: false };
  }
  return { ok: true, simulated: false };
}

// ---------- Twilio ----------

async function sendSmsViaTwilio(phone, message) {
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
  if (orangeConfigured) {
    try {
      return await sendSmsViaOrange(phone, message);
    } catch (err) {
      console.error('Envoi SMS Orange erreur :', err);
      // Se rabat sur Twilio s'il est également configuré, plutôt que de
      // laisser l'utilisateur sans aucun code.
      if (twilioConfigured) return sendSmsViaTwilio(phone, message);
      return { ok: false, simulated: false };
    }
  }
  return sendSmsViaTwilio(phone, message);
}

module.exports = { sendSms, isSmsConfigured: () => configured };
