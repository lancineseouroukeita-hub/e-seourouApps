const prisma = require('../config/prisma');
const { isPushConfigured, vapidPublicKey } = require('../utils/push');

// Clé publique VAPID nécessaire côté navigateur pour s'abonner (pushManager.subscribe).
// Pas besoin d'être connecté pour la récupérer, ce n'est pas une donnée secrète.
async function getVapidPublicKey(req, res) {
  return res.json({ publicKey: vapidPublicKey(), enabled: isPushConfigured() });
}

// Enregistre (ou met à jour) l'abonnement push envoyé par le navigateur pour l'utilisateur connecté.
async function subscribe(req, res) {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Abonnement push invalide.' });
    }
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
      create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement de la notification.' });
  }
}

// Supprime un abonnement (ex: l'utilisateur désactive les notifications).
async function unsubscribe(req, res) {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('push unsubscribe error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getVapidPublicKey, subscribe, unsubscribe };
