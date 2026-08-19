const webpush = require('web-push');
const prisma = require('../config/prisma');

// Les clés VAPID identifient notre serveur auprès des services de notification
// push (Google/Mozilla/Apple selon le navigateur). Elles doivent être définies
// en variables d'environnement sur Render : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (une adresse "mailto:" de contact, exigée par le protocole).
// Générées une seule fois avec `npx web-push generate-vapid-keys` (ou l'API
// webpush.generateVAPIDKeys()) — ne jamais les régénérer sans mettre à jour les
// deux (le public ET le privé vont ensemble).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@example.com';

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
} else {
  console.warn(
    'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absents des variables d\'environnement : ' +
    'les notifications push sont désactivées (l\'app fonctionne normalement sans).'
  );
}

// Envoie une notification push à TOUS les appareils/navigateurs abonnés d'un utilisateur.
// N'échoue jamais bruyamment : une erreur d'envoi (ex: notification refusée entre-temps)
// ne doit jamais faire planter l'envoi du message/l'appel lui-même.
async function sendPushToUser(userId, payload) {
  if (!configured) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  } catch (err) {
    console.error('sendPushToUser error:', err);
  }
}

async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    // 404/410 = abonnement expiré ou révoqué (désinstallation, permission retirée...) :
    // on le supprime silencieusement plutôt que de réessayer indéfiniment.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    } else {
      console.error('Push notification error:', err.statusCode, err.body || err.message);
    }
  }
}

module.exports = {
  sendPushToUser,
  isPushConfigured: () => configured,
  vapidPublicKey: () => VAPID_PUBLIC_KEY || null,
};
