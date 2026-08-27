const express = require('express');
const { getWallet } = require('../controllers/wallet.controller');
const { initiatePurchase, handleNotify } = require('../controllers/creditPurchase.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// "Solde" (menu ☰ de Diarala_Tiktak, voir wallet.controller.js) — lecture du
// solde + historique. La plupart des mouvements sont declenches par une
// AUTRE action (aimer une video, suivre quelqu'un, "Promouvoir" une
// publication — voir video.controller.js et follow.controller.js), jamais
// directement par le client.
router.get('/', requireAuth, asyncHandler(getWallet));

// Achat de credits avec du vrai argent (mobile money via CinetPay), voir
// creditPurchase.controller.js. Renvoie l'URL de paiement vers laquelle
// rediriger l'utilisateur.
router.post('/purchase', requireAuth, asyncHandler(initiatePurchase));

// Webhook appele DIRECTEMENT par CinetPay (pas par l'application/l'utilisateur)
// une fois un paiement termine -- volontairement SANS requireAuth, CinetPay
// n'a pas de token JWT de notre application. La securite vient d'ailleurs :
// on revérifie toujours le statut aupres de CinetPay elle-meme avant de
// crediter quoi que ce soit (voir creditPurchase.controller.js, handleNotify).
router.post('/purchase/notify', asyncHandler(handleNotify));

module.exports = router;