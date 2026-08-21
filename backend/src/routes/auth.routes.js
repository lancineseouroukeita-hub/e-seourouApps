const express = require('express');
const {
  register,
  login,
  me,
  sendVerificationOtp,
  verifyPhone,
  forgotPassword,
  resetPassword,
  deleteMyAccount,
} = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { authRateLimit } = require('../utils/rateLimit');

const router = express.Router();

// authRateLimit avant tout : freine le brute-force sur mot de passe (aucune
// autre protection n'existait sur ces deux routes jusqu'ici).
router.post('/register', authRateLimit, asyncHandler(register));
router.post('/login', authRateLimit, asyncHandler(login));
router.get('/me', requireAuth, asyncHandler(me));

// Vérification de numéro par OTP (Paramètres) : même limiteur que
// register/login pour éviter d'épuiser un crédit SMS par brute-force.
router.post('/otp/send', requireAuth, authRateLimit, asyncHandler(sendVerificationOtp));
router.post('/otp/verify', requireAuth, authRateLimit, asyncHandler(verifyPhone));

// Mot de passe oublié : les deux étapes sont publiques (pas encore connecté).
router.post('/forgot-password', authRateLimit, asyncHandler(forgotPassword));
router.post('/reset-password', authRateLimit, asyncHandler(resetPassword));

// Suppression de compte (Paramètres).
router.delete('/me', requireAuth, asyncHandler(deleteMyAccount));

module.exports = router;
