const express = require('express');
const { getWallet } = require('../controllers/wallet.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// "Solde" (menu ☰ de Diarala_Tiktak, voir wallet.controller.js) — un seul
// endpoint pour l'instant : lecture du solde + historique. Les mouvements
// eux-mêmes sont toujours déclenchés par une AUTRE action (aimer une vidéo,
// suivre quelqu'un, "Promouvoir" une publication — voir video.controller.js
// et follow.controller.js), jamais directement par le client.
router.get('/', requireAuth, asyncHandler(getWallet));

module.exports = router;
