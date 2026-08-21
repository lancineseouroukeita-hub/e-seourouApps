// Codes à usage unique (OTP) envoyés par SMS : vérification de numéro de
// téléphone, et mot de passe oublié. Voir OtpCode dans schema.prisma pour le
// choix de ne PAS lier ce modèle à User par une relation stricte.
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { sendSms } = require('./sms');

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
// Anti-spam : empêche de redemander un code en boucle (ex: script malveillant
// qui viderait le crédit SMS Twilio). Purement en mémoire, comme
// utils/rateLimit.js — acceptable pour une seule instance de serveur.
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const lastSentAt = new Map(); // clé: `${phone}:${purpose}` -> timestamp

function generateCode() {
  // Toujours OTP_LENGTH chiffres, y compris avec des zéros de tête.
  const max = 10 ** OTP_LENGTH;
  return String(Math.floor(Math.random() * max)).padStart(OTP_LENGTH, '0');
}

// Génère un nouveau code, invalide silencieusement les précédents pour le même
// (phone, purpose), l'enregistre (hashé) en base, et l'envoie par SMS (ou le
// journalise si aucun fournisseur SMS n'est configuré, voir utils/sms.js).
async function createAndSendOtp(phone, purpose) {
  const cooldownKey = `${phone}:${purpose}`;
  const last = lastSentAt.get(cooldownKey);
  if (last && Date.now() - last < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, error: 'Veuillez attendre avant de redemander un code.' };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Invalide tout code encore actif pour ce (phone, purpose) : un seul code
  // valide à la fois, comme un mot de passe à usage unique classique.
  await prisma.otpCode.updateMany({
    where: { phone, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.otpCode.create({ data: { phone, codeHash, purpose, expiresAt } });
  lastSentAt.set(cooldownKey, Date.now());

  const label = purpose === 'reset_password'
    ? `Votre code seourouApps pour réinitialiser votre mot de passe : ${code} (valable 10 minutes).`
    : `Votre code seourouApps de vérification : ${code} (valable 10 minutes).`;
  const result = await sendSms(phone, label);
  return { ok: true, simulated: result.simulated };
}

// Vérifie un code saisi pour un (phone, purpose). Retourne { ok: true } si
// valide (et marque le code comme consommé), sinon { ok: false, error }.
async function verifyOtp(phone, purpose, code) {
  if (!code || typeof code !== 'string') {
    return { ok: false, error: 'Code requis.' };
  }

  const otp = await prisma.otpCode.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) return { ok: false, error: 'Aucun code actif. Demandez-en un nouveau.' };
  if (otp.expiresAt < new Date()) return { ok: false, error: 'Code expiré. Demandez-en un nouveau.' };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: 'Trop de tentatives. Demandez un nouveau code.' };
  }

  const valid = await bcrypt.compare(String(code).trim(), otp.codeHash);
  if (!valid) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });
    return { ok: false, error: 'Code incorrect.' };
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return { ok: true };
}

module.exports = { createAndSendOtp, verifyOtp };
