const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getVapidPublicKey, subscribe, unsubscribe } = require('../controllers/push.controller');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/vapid-public-key', asyncHandler(getVapidPublicKey));
router.post('/subscribe', requireAuth, asyncHandler(subscribe));
router.post('/unsubscribe', requireAuth, asyncHandler(unsubscribe));

module.exports = router;
