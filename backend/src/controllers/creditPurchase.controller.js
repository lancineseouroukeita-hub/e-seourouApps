const prisma = require('../config/prisma');

// Achat de credits "Solde" avec du vrai argent (mobile money), voir
// schema.prisma (modele CreditPurchase) et wallet.controller.js (le reste du
// systeme "Solde", qui reste inchange -- ceci ajoute juste une DEUXIEME
// facon d'obtenir des credits, en plus d'etre aime/suivi). Utilise
// l'agregateur CinetPay (docs.cinetpay.com), qui supporte explicitement la
// Guinee/le GNF et relaie Orange Money + MTN Mobile Money.
//
// Utilise le fetch() natif de Node (disponible depuis Node 18, deja le
// minimum requis par ce projet -- voir package.json "engines") : pas besoin
// d'ajouter axios/node-fetch comme dependance.

const CINETPAY_INIT_URL = 'https://api-checkout.cinetpay.com/v2/payment';
const CINETPAY_CHECK_URL = 'https://api-checkout.cinetpay.com/v2/payment/check';

// Combien de credits "Solde" pour 1 GNF depense -- taux de conversion de
// depart, arbitraire et facile a expliquer ("payez X GNF, recevez X
// credits"). A AJUSTER selon ce que valent deja les credits gratuits
// (likes/abonnes, voir video.controller.js/follow.controller.js) pour que
// les deux facons de gagner des credits restent coherentes entre elles.
const CREDITS_PER_GNF = 1;

// CinetPay exige un montant multiple de 5 (voir leur documentation
// d'initialisation de paiement) ; 500 GNF est juste un minimum de depart
// raisonnable pour eviter des tentatives de paiement pour quelques francs.
const MIN_PURCHASE_GNF = 500;

// POST /api/wallet/purchase (authentifie) — { amountGnf } dans le corps.
// Cree une demande de paiement en base (status "pending") puis demande a
// CinetPay un lien de paiement, a renvoyer au client pour qu'il y redirige
// l'utilisateur (dans un nouvel onglet/une redirection complete, pas un
// iframe -- CinetPay gere lui-meme le choix Orange Money/MTN et la saisie
// du code de confirmation).
async function initiatePurchase(req, res) {
  try {
    const amountGnf = Number(req.body.amountGnf);
    if (!Number.isInteger(amountGnf) || amountGnf < MIN_PURCHASE_GNF || amountGnf % 5 !== 0) {
      return res.status(400).json({
        error: `Montant invalide (minimum ${MIN_PURCHASE_GNF} GNF, doit etre un multiple de 5).`,
      });
    }

    if (!process.env.CINETPAY_APIKEY || !process.env.CINETPAY_SITE_ID || !process.env.PUBLIC_BASE_URL) {
      // Configuration pas encore faite (voir .env.example) -- erreur claire
      // plutot qu'un plantage confus plus loin.
      return res.status(503).json({
        error: "Paiement pas encore configure sur ce serveur (CINETPAY_APIKEY / CINETPAY_SITE_ID / PUBLIC_BASE_URL manquants).",
      });
    }

    const creditsGranted = amountGnf * CREDITS_PER_GNF;

    const purchase = await prisma.creditPurchase.create({
      data: {
        userId: req.user.id,
        amountGnf,
        creditsGranted,
        status: 'pending',
        provider: 'cinetpay',
      },
    });

    const cinetpayRes = await fetch(CINETPAY_INIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_APIKEY,
        site_id: process.env.CINETPAY_SITE_ID,
        // On reutilise l'id du CreditPurchase comme identifiant de
        // transaction cote CinetPay : simple, et ca evite d'avoir a stocker
        // un identifiant separe juste pour faire la correspondance.
        transaction_id: purchase.id,
        amount: amountGnf,
        currency: 'GNF',
        description: `Achat de ${creditsGranted} credits seourouApps`,
        notify_url: `${process.env.PUBLIC_BASE_URL}/api/wallet/purchase/notify`,
        return_url: `${process.env.PUBLIC_BASE_URL}/`,
        channels: 'MOBILE_MONEY',
      }),
    });
    const cinetpayData = await cinetpayRes.json();

    if (!cinetpayData || !cinetpayData.data || !cinetpayData.data.payment_url) {
      console.error('CinetPay initialisation echouee:', cinetpayData);
      await prisma.creditPurchase.update({ where: { id: purchase.id }, data: { status: 'failed' } });
      return res.status(502).json({ error: "Impossible d'initier le paiement pour le moment. Reessayez plus tard." });
    }

    return res.json({ purchaseId: purchase.id, paymentUrl: cinetpayData.data.payment_url });
  } catch (err) {
    console.error('initiatePurchase error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}

// POST /api/wallet/purchase/notify — webhook appele DIRECTEMENT par CinetPay
// (pas par l'application), volontairement sans authentification JWT (voir
// wallet.routes.js). SECURITE IMPORTANTE (voir docs.cinetpay.com/.../notification) :
// CinetPay envoie cette notification SANS le statut du paiement, precisement
// pour empecher qu'un tiers malveillant puisse la falsifier et se faire
// crediter sans avoir paye. On ne fait donc JAMAIS confiance a ce que
// contient la requete : on revérifie toujours le vrai statut en interrogeant
// CinetPay soi-meme (CINETPAY_CHECK_URL) avant de crediter quoi que ce soit.
async function handleNotify(req, res) {
  try {
    const transactionId = req.body.cpm_trans_id;
    if (!transactionId) {
      return res.status(400).send('cpm_trans_id manquant');
    }

    const purchase = await prisma.creditPurchase.findUnique({ where: { id: transactionId } });
    if (!purchase) {
      return res.status(404).send('Achat introuvable');
    }
    if (purchase.status === 'completed') {
      // CinetPay peut renvoyer plusieurs notifications pour le meme paiement
      // -- deja traite, on repond OK sans recrediter une deuxieme fois.
      return res.status(200).send('OK');
    }

    const checkRes = await fetch(CINETPAY_CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: process.env.CINETPAY_APIKEY,
        site_id: process.env.CINETPAY_SITE_ID,
        transaction_id: transactionId,
      }),
    });
    const checkData = await checkRes.json();
    const status = checkData && checkData.data ? checkData.data.status : null;

    if (status === 'ACCEPTED') {
      await prisma.$transaction([
        prisma.creditPurchase.update({
          where: { id: purchase.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            providerReference: (checkData.data && checkData.data.payment_method) || null,
          },
        }),
        prisma.creditTransaction.create({
          data: { userId: purchase.userId, amount: purchase.creditsGranted, reason: 'achat_credits' },
        }),
        prisma.user.update({
          where: { id: purchase.userId },
          data: { creditsBalance: { increment: purchase.creditsGranted } },
        }),
      ]);
    } else if (status && status !== 'PENDING' && status !== 'WAITING_FOR_CUSTOMER') {
      await prisma.creditPurchase.update({ where: { id: purchase.id }, data: { status: 'failed' } });
    }
    // Si le statut est encore "PENDING"/"WAITING_FOR_CUSTOMER", on ne touche
    // a rien -- CinetPay renverra une nouvelle notification plus tard.

    return res.status(200).send('OK');
  } catch (err) {
    console.error('handleNotify error:', err);
    // On repond quand meme 200 : une erreur de notre cote ne doit pas faire
    // reessayer CinetPay en boucle indefiniment. L'achat reste "pending" en
    // base, consultable manuellement (via Prisma Studio) en cas de doute.
    return res.status(200).send('OK');
  }
}

module.exports = { initiatePurchase, handleNotify };