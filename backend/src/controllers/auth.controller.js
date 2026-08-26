const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');
const { createAndSendOtp, verifyOtp } = require('../utils/otp');
const { isAdminPhone } = require('../utils/adminPhones');
// normalizePhone/PHONE_REGEX vivent maintenant dans utils/phone.js (partagé
// avec contact.controller.js), comportement inchangé.
const { normalizePhone, PHONE_REGEX } = require('../utils/phone');
const { describeDevice } = require('../utils/deviceLabel');

// Crée l'entrée "Appareil" correspondant à CETTE connexion (Paramètres →
// Appareils connectés) et renvoie son id, à inclure dans le token JWT (voir
// utils/jwt.js / middleware/auth.js). Chaque connexion (register ou login)
// crée un nouvel appareil — comme il n'y a pas de session persistée côté
// client (le token vit seulement en mémoire, pas en localStorage), un appareil
// correspond en pratique à un onglet/une ouverture de l'appli, pas à un
// identifiant matériel stable. Suffisant pour voir et révoquer ce qui est
// connecté EN CE MOMENT, qui est le but de cet écran (comme WhatsApp).
async function createDeviceForRequest(req, userId) {
  const userAgent = req.headers['user-agent'] || null;
  return prisma.device.create({
    data: { userId, label: describeDevice(userAgent), userAgent },
  });
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    // Dernière fois qu'il avait au moins un appareil connecté (voir
    // utils/presence.js) : le champ "online" calculé séparément (voir
    // user.controller.js listUsers) prévaut côté client quand il est présent.
    lastSeenAt: user.lastSeenAt || null,
    // Vue par le propriétaire du compte lui-même (ex: écran Paramètres) : la
    // vraie valeur. Les autres utilisateurs ne la voient jamais (voir
    // user.controller.js / conversation.controller.js, qui la masquent).
    hideLastSeen: Boolean(user.hideLastSeen),
    // Vrai si ce numéro a été confirmé par code OTP (voir sendVerificationOtp /
    // verifyPhone plus bas) : purement informatif pour l'instant, affiché comme
    // un badge "Numéro vérifié" dans Paramètres.
    phoneVerified: Boolean(user.phoneVerified),
    // Administrateur de l'application (voir utils/adminPhones.js) : affiché
    // côté client pour ne montrer la section Paramètres → Administration
    // qu'aux personnes concernées.
    isAdmin: Boolean(user.isAdmin),
    // Autorise les AUTRES personnes à télécharger les publications "Clips" de
    // cet utilisateur (voir schema.prisma, User.allowDownloads et
    // videos.html, clipOptDownload) -- true par défaut si jamais absent (ex:
    // avant la migration côté base), pour ne rien changer au comportement
    // existant tant que la personne n'a pas explicitement désactivé.
    allowDownloads: user.allowDownloads !== false,
  };
}

// Si ce numéro est listé dans ADMIN_PHONES mais que le compte n'a pas encore
// le statut administrateur en base (premier login après ajout du numéro dans
// la variable d'environnement, ou compte créé avant), on le met à jour ici —
// pas besoin d'action manuelle en base de données. Ne retire jamais isAdmin
// automatiquement : voir le commentaire sur User.isAdmin dans schema.prisma.
async function ensureAdminFlag(user) {
  if (!user.isAdmin && isAdminPhone(user.phone)) {
    return prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
  }
  return user;
}

async function register(req, res) {
  try {
    const { name } = req.body;
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'name, phone et password sont requis.' });
    }
    if (!PHONE_REGEX.test(phone)) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec ce numéro de téléphone.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    let user = await prisma.user.create({
      data: { name, phone, password: hashed },
    });
    user = await ensureAdminFlag(user);

    const device = await createDeviceForRequest(req, user.id);
    const token = signToken({ id: user.id, phone: user.phone, name: user.name, deviceId: device.id });
    return res.status(201).json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'inscription.' });
  }
}

async function login(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'phone et password sont requis.' });
    }

    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(401).json({ error: 'Numéro de téléphone ou mot de passe incorrect.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Numéro de téléphone ou mot de passe incorrect.' });
    }
    user = await ensureAdminFlag(user);

    const device = await createDeviceForRequest(req, user.id);
    const token = signToken({ id: user.id, phone: user.phone, name: user.name, deviceId: device.id });
    return res.json({ user: toPublicUser(user), token });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
}

async function me(req, res) {
  let user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  user = await ensureAdminFlag(user);
  return res.json({ user: toPublicUser(user) });
}

// Envoie (ou renvoie) un code OTP par SMS pour confirmer le numéro de
// l'utilisateur connecté (Paramètres → "Vérifier mon numéro"). Toujours son
// PROPRE numéro (celui de son compte) : pas de paramètre "phone" ici, pour
// éviter qu'on puisse déclencher l'envoi de SMS vers un numéro arbitraire.
async function sendVerificationOtp(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (user.phoneVerified) return res.json({ ok: true, alreadyVerified: true });

    const result = await createAndSendOtp(user.phone, 'verify_phone');
    if (!result.ok) return res.status(429).json({ error: result.error });
    return res.json({ ok: true, simulated: result.simulated });
  } catch (err) {
    console.error('sendVerificationOtp error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'envoi du code.' });
  }
}

// Confirme le code reçu par SMS et marque le numéro comme vérifié.
async function verifyPhone(req, res) {
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const result = await verifyOtp(user.phone, 'verify_phone', code);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const updated = await prisma.user.update({ where: { id: user.id }, data: { phoneVerified: true } });
    return res.json({ ok: true, user: toPublicUser(updated) });
  } catch (err) {
    console.error('verifyPhone error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la vérification du code.' });
  }
}

// Demande un code de réinitialisation de mot de passe pour un numéro donné
// (écran "Mot de passe oublié", pas besoin d'être connecté). Répond toujours
// { ok: true } que le numéro corresponde ou non à un compte existant, pour ne
// pas laisser deviner quels numéros sont inscrits (énumération de comptes) —
// seul un compte existant reçoit réellement un SMS.
async function forgotPassword(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone || !PHONE_REGEX.test(phone)) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (user) {
      const result = await createAndSendOtp(phone, 'reset_password');
      if (!result.ok) return res.status(429).json({ error: result.error });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la demande de réinitialisation.' });
  }
}

// Confirme le code reçu par SMS et enregistre le nouveau mot de passe.
async function resetPassword(req, res) {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ error: 'phone, code et newPassword sont requis.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) return res.status(400).json({ error: 'Code incorrect.' }); // pas de fuite d'existence de compte

    const result = await verifyOtp(phone, 'reset_password', code);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la réinitialisation du mot de passe.' });
  }
}

// Suppression définitive du compte connecté (Paramètres → "Supprimer mon
// compte"), confirmée par le mot de passe. Cascade en base (voir
// schema.prisma, onDelete: Cascade sur toutes les relations de User) :
// messages envoyés, participations aux discussions, appels, statuts,
// communautés créées, abonnements push, etc. sont supprimés avec le compte.
async function deleteMyAccount(req, res) {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe requis pour confirmer la suppression.' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    await prisma.user.delete({ where: { id: user.id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteMyAccount error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression du compte.' });
  }
}

// Revérifie le mot de passe du compte connecté, sans rien changer : sert de
// "porte d'entrée" pour les Discussions verrouillées (comme le déverrouillage
// biométrique/code de WhatsApp) — on redemande une preuve d'identité avant de
// révéler ces conversations, sans exiger une reconnexion complète.
async function verifyPassword(req, res) {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe requis.' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect.' });

    return res.json({ ok: true });
  } catch (err) {
    console.error('verifyPassword error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la vérification du mot de passe.' });
  }
}

module.exports = {
  register,
  login,
  me,
  toPublicUser,
  sendVerificationOtp,
  verifyPhone,
  forgotPassword,
  resetPassword,
  deleteMyAccount,
  verifyPassword,
};
