const express = require('express');
const { register, login, me } = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { authRateLimit } = require('../utils/rateLimit');

const router = express.Router();

// authRateLimit avant tout : freine le brute-force sur mot de passe (aucune
// autre protection n'existait sur ces deux routes jusqu'ici).
router.post('/register', authRateLimit, asyncHandler(register));
router.post('/login', authRateLimit, asyncHandler(login));
router.get('/me', requireAuth, asyncHandler(me));

module.exports = router;
